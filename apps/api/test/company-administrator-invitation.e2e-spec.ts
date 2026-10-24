import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from './utils/test-app';
import {
  createProviderUser,
  createUserInOrganization,
  bearerHeader,
} from './utils/provider-user';
import {
  TEST_ORGANIZATION_ID,
  deleteFixtureUsersInOrganization,
  deleteOrganizationCascade,
  rawPrisma,
} from './tenant-prisma';
import { INSURANCE_COMPANY_ADMINISTRATOR_GRANTS } from '../src/modules/provider/insurance-company-administrator-grants';

/**
 * MODULE 0-ب ITEM (f), COMPANY HALF — over real HTTP.
 *
 * ## WHAT THIS FILE CAN AND CANNOT COVER, STATED RATHER THAN LEFT AS A GAP
 *
 * It covers the invite — success, all three refusals, and the role the company was registered with.
 * It does NOT authenticate as an invited company administrator, and that is the same hard limit the
 * brokerage half carries for the same measured reason: signing in writes `AuditLogEntry` rows into
 * that organization's own tenant, `AuditLogEntry_organizationId_fkey` is `ON DELETE RESTRICT`, and
 * DELETE on that table is refused outright by the `audit_log_entry_no_delete` trigger. ONE row makes
 * the organization permanent. Two brokerage offices were stranded in db-test proving it, and clearing
 * them needed the trigger disabled and re-enabled by hand.
 *
 * So `GET /company/registry-record`'s 200 path is covered by its SCREEN test against a mocked API,
 * and its 403 path is covered here — because a brokerage user needs no company to be refused.
 *
 * The invite itself is safe to run: its audit row is written OUTSIDE `runAs`, into the PROVIDER's
 * log, so the company gets no audit row and stays deletable once the user and assignment are gone.
 * That placement was a deliberate decision on the brokerage half and this file is what proves it
 * still holds — if a future change moves that `record()` call inside `runAs`, the teardown below
 * starts failing on a foreign key.
 */

let app: INestApplication<App>;
let operator: { accessToken: string; userId: string; organizationId: string };
const createdCompanyIds: string[] = [];
/* Roles created inside the DEFAULT brokerage office for the refusal tests. They are not in a
 * company, so `deleteCompany` never reaches them, and a leaked role breaks
 * `role-security-attributes.e2e-spec.ts`, which reads the SET of roles. */
const createdRoleIds: string[] = [];

let legalFormId: string;
let licensingAuthorityId: string;
let businessModelId: string;
let countryId: string;
let cityId: string;
let bankId: string;
let lineIds: string[];

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let seq = 0;
const unique = (prefix: string) => `${prefix}${RUN}${seq++}`;

interface Registered {
  id: string;
  administratorRoleId: string;
}
interface Invited {
  companyId: string;
  userId: string;
  email: string;
  roleName: string;
  howTheySignIn: string;
  /* DECISION 25. Hand-copied over HTTP like every interface in these specs, which is why the
   * decision-25 tests below assert the EXACT KEY SET on the response body rather than trusting
   * this shape: a field this declaration lacks is not a type error, it is a silent drop. */
  invitation: {
    outcome: string;
    fromAddress: string | null;
    devInvitationToken?: string;
  };
}

async function deleteCompany(organizationId: string) {
  /*
   * KEYED ON THE REAL CAUSE — an AUDIT ROW, not a user. A user can be deleted; an audit row cannot,
   * and one is enough to make the organization permanent. Failing here BY NAME is what stops this
   * recurring as an opaque foreign-key error in a teardown three changes from now.
   */
  const auditRows = await rawPrisma.auditLogEntry.count({
    where: { organizationId },
  });
  if (auditRows > 0) {
    throw new Error(
      `insurance company ${organizationId} has ${auditRows} AuditLogEntry row(s) and can never be deleted: ` +
        'that table is append-only by trigger and its organization FK is RESTRICT. Something in this run ' +
        'authenticated as a company user, or an audit row was written inside `runAs`. Both are forbidden here ' +
        "— see this file's header.",
    );
  }

  /*
   * Through the SHARED helper: decision 25's invitation issues a `PasswordResetToken` for the
   * invited administrator, and `PasswordResetToken_userId_fkey` is not a cascade. Spelled out here
   * it threw inside `afterAll`, the company leaked, and db-test accumulated a dozen of them before
   * CI said so — invisible locally because I read the run output through a grep that could not
   * match an afterAll error.
   */
  await deleteFixtureUsersInOrganization(organizationId);
  await rawPrisma.rolePermission.deleteMany({ where: { organizationId } });
  await rawPrisma.role.deleteMany({ where: { organizationId } });
  await rawPrisma.insurerLicensedLine.deleteMany({
    where: { insuranceCompanyId: organizationId },
  });
  // The certificate pointer must be cleared before the Document can go: the FK is RESTRICT.
  await rawPrisma.organization.update({
    where: { id: organizationId },
    data: { insurerLicenseCertificateDocumentId: null },
  });
  await rawPrisma.document.deleteMany({ where: { organizationId } });
  // Branch and Department now BLOCK this delete — see `deleteOrganizationCascade`.
  await deleteOrganizationCascade(organizationId);
}

async function sweepRunLeftovers() {
  const stale = await rawPrisma.organization.findMany({
    where: { type: 'INSURANCE_COMPANY', code: { startsWith: 'CO' } },
    select: { id: true },
  });
  for (const row of stale) {
    try {
      await deleteCompany(row.id);
    } catch {
      // A company carrying an audit row cannot be removed. Leaving it is better than aborting the
      // sweep for the ones that can.
    }
  }
}

beforeAll(async () => {
  // On ENTRY as well as on exit, because an `afterAll` is exactly what cannot be relied on.
  await sweepRunLeftovers();
  app = await createTestApp();
  operator = await createProviderUser(app, 'provider-company-invitation');

  const [lf, la, bm, co, ci, bk, lines] = await Promise.all([
    rawPrisma.legalForm.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.licensingAuthority.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.businessModel.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.country.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.city.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.bank.findFirstOrThrow({ select: { id: true } }),
    rawPrisma.insuranceLine.findMany({
      where: { category: 'GENERAL' },
      take: 2,
      select: { id: true },
    }),
  ]);
  legalFormId = lf.id;
  licensingAuthorityId = la.id;
  businessModelId = bm.id;
  countryId = co.id;
  cityId = ci.id;
  bankId = bk.id;
  lineIds = lines.map((l) => l.id);
}, 240_000);

afterAll(async () => {
  for (const id of createdRoleIds) {
    try {
      /*
       * THE ROLE GOES; THE USER STAYS — and both halves were learned by measuring a leak rather than
       * by reasoning.
       *
       * My first version deleted the user too, and the whole teardown then failed SILENTLY: grants
       * and assignments were removed, the user delete threw, the role survived, and four stray roles
       * accumulated across two runs with nothing printed. The cause is the same undeletability this
       * file's header is about, one level down: `createUserInOrganization` SIGNS THE USER IN, a login
       * writes `AuditLogEntry` rows, and `AuditLogEntry_userId_fkey` is `ON DELETE RESTRICT`. A user
       * who has authenticated cannot be deleted by any ordinary route.
       *
       * So the user is left in the default office — which is what every spec using this helper does,
       * and harmless: nothing asserts a user COUNT there. The ROLE is what must go, because
       * `role-security-attributes.e2e-spec.ts` reads the SET of roles and a stray one breaks it.
       */
      await rawPrisma.rolePermission.deleteMany({ where: { roleId: id } });
      await rawPrisma.userRoleAssignment.deleteMany({ where: { roleId: id } });
      await rawPrisma.role.delete({ where: { id } });
    } catch (error) {
      console.error(`role teardown failed for ${id}:`, error);
    }
  }
  for (const id of createdCompanyIds) {
    try {
      await deleteCompany(id);
    } catch (error) {
      // Reported rather than swallowed: a company left behind changes what sibling specs see.
      console.error(`company teardown failed for ${id}:`, error);
    }
  }
  await app?.close();
});

async function registerCompany(): Promise<Registered> {
  const response = await request(app.getHttpServer())
    .post('/provider/insurance-companies')
    .set(...bearerHeader(operator.accessToken))
    .send({
      legalName: unique('Company '),
      legalNameAr: `شركة ${unique('')}`,
      shortName: unique('CO'),
      code: unique('CO'),
      subdomain: unique('co'),
      nationalEstablishmentNo: unique('NE'),
      commercialRegistrationNo: unique('CR'),
      taxNumber: unique('TX'),
      legalFormId,
      insurerLicenseNumber: unique('IL'),
      // BATCH 5 GROUP 7d — the licence EXPIRY is required now, because the standing is derived
      // from it. Far in the future so this fixture reads CURRENT rather than depending on when
      // the suite happens to run.
      insurerLicenseExpiresAt: '2099-12-31',
      licensingAuthorityId,
      businessModelId,
      countryId,
      cityId,
      address: 'Amman',
      phone: '+962-6-0000000',
      email: `${unique('co')}@example.test`,
      quotationEmail: `${unique('q')}@example.test`,
      claimsEmail: `${unique('c')}@example.test`,
      integrationMethod: 'EMAIL',
      bankId,
      iban: 'JO94CBJO0010000000000131000302',
      certificateFileName: 'licence.pdf',
      certificateStorageRef: 'co/licence.pdf',
      licensedLineIds: lineIds,
    })
    .expect(201);
  const body = response.body as Registered;
  createdCompanyIds.push(body.id);
  return body;
}

describe('item (f) company half — registration creates the administrator role', () => {
  it('creates INSURANCE_COMPANY_ADMINISTRATOR with exactly the declared grants, and nothing more', async () => {
    const company = await registerCompany();

    expect(company.administratorRoleId).toBeTruthy();

    const role = await rawPrisma.role.findFirstOrThrow({
      where: { id: company.administratorRoleId },
      select: {
        name: true,
        isSystem: true,
        requiresMfaAlways: true,
        requiresHardwareToken: true,
        organizationId: true,
      },
    });
    expect(role.name).toBe('INSURANCE_COMPANY_ADMINISTRATOR');
    // The strict values, stated at creation so a later change to a column default cannot silently
    // relax the first administrator of every company registered afterwards.
    expect(role.isSystem).toBe(true);
    expect(role.requiresMfaAlways).toBe(true);
    expect(role.requiresHardwareToken).toBe(true);
    // The role belongs to the COMPANY, not to the provider that created it — `runAs` is what makes
    // that true, and asserting it is what would catch a future change to `runUnscoped`.
    expect(role.organizationId).toBe(company.id);

    const grants = await rawPrisma.rolePermission.findMany({
      where: { roleId: company.administratorRoleId },
      select: { permission: { select: { code: true } } },
    });
    const codes = grants.map((g) => g.permission.code).sort();

    /*
     * AN EXACT SET, not a count. A count survives a substitution — six codes could become six
     * different codes and still pass — which is the assertion class this module spent its close
     * correcting.
     */
    expect(codes).toEqual([...INSURANCE_COMPANY_ADMINISTRATOR_GRANTS].sort());

    // And the shortness stated as a property: NOTHING about placing business, money, or customers.
    for (const code of codes) {
      expect(code).not.toMatch(
        /^(customer|policy|claim|invoice|commission|refund|receipt|remittance)\./,
      );
    }
  });
});

describe('item (f) company half — the invite', () => {
  it('creates the FIRST account, grants the company role, and writes NO audit row into the company', async () => {
    const company = await registerCompany();

    const response = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason: 'Handing the company its first account after registration.',
      })
      .expect(201);

    const invited = response.body as Invited;
    expect(invited.companyId).toBe(company.id);
    expect(invited.roleName).toBe('INSURANCE_COMPANY_ADMINISTRATOR');
    expect(invited.howTheySignIn).toBe('PASSWORD_RESET');

    const user = await rawPrisma.user.findFirstOrThrow({
      where: { id: invited.userId },
      select: {
        organizationId: true,
        mustChangePassword: true,
        isActive: true,
      },
    });
    expect(user.organizationId).toBe(company.id);
    expect(user.mustChangePassword).toBe(true);
    expect(user.isActive).toBe(true);

    const assignment = await rawPrisma.userRoleAssignment.findFirstOrThrow({
      where: { userId: invited.userId, revokedAt: null },
      select: { roleId: true },
    });
    expect(assignment.roleId).toBe(company.administratorRoleId);

    /*
     * THE PLACEMENT ASSERTION, and it is the one that keeps this file re-runnable. The invite's audit
     * row belongs in the PROVIDER's log; one row in the COMPANY's log would make that organization
     * permanent and the teardown would start failing on a foreign key.
     */
    const companyAuditRows = await rawPrisma.auditLogEntry.count({
      where: { organizationId: company.id },
    });
    expect(
      companyAuditRows,
      "the invite wrote an audit row into the COMPANY. That makes the organization permanently undeletable — the row belongs in the provider's log, which is why `record()` is called outside `runAs`.",
    ).toBe(0);

    const providerAuditRows = await rawPrisma.auditLogEntry.count({
      where: {
        organizationId: operator.organizationId,
        entityType: 'User',
        entityId: invited.userId,
      },
    });
    expect(providerAuditRows).toBe(1);
  });

  it('ALLOWS a second invite while nobody has entered, to a CORRECTED address — this used to be a 409', async () => {
    /*
     * THE REVERSAL, STATED RATHER THAN QUIETLY REPOINTED. This test asserted a 409 until decision
     * 26, and the refusal it pinned is not gone — it MOVED. `refusal 3 — the protection` below
     * asserts it for an organization somebody has entered, which is the case the refusal was
     * written for.
     *
     * What changed is the case it ALSO covered by accident: an organization nobody has ever
     * entered. That is a registration that did not complete, and refusing there left the
     * organization permanently unreachable — the invitation token expires in 120 minutes, the
     * invited account cannot request its own reset (its organization has no mailbox), and the
     * provider could not re-invite. A MISTYPED ADDRESS made it dead on arrival.
     *
     * The decision-90 assertion below is kept: a 201 still must not be reached by way of a
     * database artefact leaking into a message somewhere else in the flow.
     */
    const company = await registerCompany();
    const body = {
      email: `${unique('first')}@example.test`,
      fullName: 'First Administrator',
      reason: 'The first account for this company, sent to a mistyped address.',
    };
    await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send(body)
      .expect(201);

    const corrected = `${unique('corrected')}@example.test`;
    const second = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        ...body,
        email: corrected,
        reason:
          'The address was mistyped; the same person at the right address.',
      })
      .expect(201);

    // The CORRECTED address is what the account carries now — the whole point of allowing a second
    // invitation rather than only re-sending to the address that was wrong.
    expect((second.body as Invited).email).toBe(corrected);
    expect(JSON.stringify(second.body)).not.toMatch(
      /violates|constraint|23505|P2002/,
    );
  });

  it('refuses a BROKERAGE OFFICE id — the two invites are separate routes with separate codes', async () => {
    const refusal = await request(app.getHttpServer())
      .post(
        `/provider/insurance-companies/${TEST_ORGANIZATION_ID}/administrator`,
      )
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('wrong')}@example.test`,
        fullName: 'Wrong Type',
        reason: 'Pointing the company route at a brokerage office.',
      })
      .expect(403);

    const message = JSON.stringify(refusal.body);
    expect(message).toContain('BROKERAGE_OFFICE');
    expect(message).toContain('INSURANCE COMPANY');
    // The refusal NAMES the other route, so whoever hit this knows where to go.
    expect(message).toContain('/provider/brokerage-offices/');
  });

  it('refuses a caller who is not the provider, even holding the code', async () => {
    const company = await registerCompany();
    /*
     * The office user is given the PLATFORM code DIRECTLY, which is the only way to reach the
     * service's own check — the permission guard would otherwise refuse first and the type check
     * would never run. A hidden control the API still honours is not a boundary, so the point of
     * this test is that the SECOND layer refuses on its own.
     */
    const permission = await rawPrisma.permission.findFirstOrThrow({
      where: { code: 'provider.insurance-company.administrator.invite' },
      select: { id: true },
    });
    const role = await rawPrisma.role.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        name: unique('HOLDS_PLATFORM_CODE_'),
        nameEn: 'Holds the platform code',
        nameAr: 'يحمل صلاحية المنصة',
      },
      select: { id: true },
    });
    await rawPrisma.rolePermission.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        roleId: role.id,
        permissionId: permission.id,
      },
    });
    const officeUser = await createUserInOrganization(app, {
      organizationId: TEST_ORGANIZATION_ID,
      roleId: role.id,
      label: 'office-holding-company-invite-code',
    });
    createdRoleIds.push(role.id);

    const refusal = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(officeUser.accessToken))
      .send({
        email: `${unique('nope')}@example.test`,
        fullName: 'Not The Provider',
        reason: 'An office trying to create an account inside a company.',
      })
      .expect(403);

    expect(JSON.stringify(refusal.body)).toContain(
      'Only the platform provider',
    );
  });
});

describe('item (f) company half — the company reads its own record', () => {
  it('refuses a BROKERAGE OFFICE user with a sentence naming where their own licence lives', async () => {
    const role = await rawPrisma.role.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        name: unique('PLAIN_OFFICE_'),
        nameEn: 'Plain office role',
        nameAr: 'دور بلا صلاحيات',
      },
      select: { id: true },
    });
    const officeUser = await createUserInOrganization(app, {
      organizationId: TEST_ORGANIZATION_ID,
      roleId: role.id,
      label: 'plain-office-user',
    });
    createdRoleIds.push(role.id);

    const refusal = await request(app.getHttpServer())
      .get('/company/registry-record')
      .set(...bearerHeader(officeUser.accessToken))
      .expect(403);

    const message = JSON.stringify(refusal.body);
    expect(message).toContain('BROKERAGE_OFFICE');
    /*
     * NEVER AN EMPTY BODY. Item (j)'s rule: an empty response reads as "there is nothing here" when
     * the truth is "this screen is not for you", so the refusal names where the reader SHOULD look.
     */
    expect(message).toContain('/regulatory-compliance');
  });

  it('refuses the PROVIDER too — the provider has its own cross-office view and is not a company', async () => {
    const refusal = await request(app.getHttpServer())
      .get('/company/registry-record')
      .set(...bearerHeader(operator.accessToken))
      .expect(403);

    expect(JSON.stringify(refusal.body)).toContain('PROVIDER');
  });
});

/* =============================================================================================
 * DECISION 25 — THE INVITATION CHANNEL.
 *
 * ## WHAT `SENT` COSTS, AND WHY IT IS NOT ASSERTED HERE
 *
 * The brief asked for a test in which the provider has an ACTIVE integration, the invited
 * organization has none, and the invitation comes back SENT with the provider's address.
 * MEASURED: `SENT` is not reachable in this suite, and the reason is structural rather than
 * laziness. `EmailProviderRegistry.resolve()` returns `NotConfiguredEmailProvider` for an ACTIVE
 * integration whenever the deployment has no OAuth application registered for that provider — and
 * this deployment has none, which is why `email-integration.e2e-spec.ts` covers only the
 * not-configured and no-OAuth-app paths and why no successful send has ever been e2e'd here.
 * Setting `EMAIL_GOOGLE_*` would construct a real provider whose `send` makes a real HTTP call to
 * Google, which would answer `SEND_FAILED`, not `SENT`.
 *
 * So the property is asserted in the form that IS reachable, and it is the property that matters:
 * THE RESOLUTION CROSSED TO THE PROVIDER'S OWN INTEGRATION ROW. `OutboundEmailService` calls
 * `recordOutcome(integration.id, …)` against whichever integration `resolve()` returned. If the
 * send sat inside `runAs(companyId)` — the mistake this design exists to avoid — the company has no
 * integration, `integration` would be `null`, and NO row would be touched at all.
 *
 * The row is identified BY ITS CONNECTED ADDRESS, which is what the brief asked for: assert the
 * address, not the call site.
 * ============================================================================================= */

/** The provider's own mailbox row, created and removed by these tests alone. */
async function connectProviderMailbox(connectedEmail: string): Promise<string> {
  const row = await rawPrisma.organizationEmailIntegration.create({
    data: {
      organizationId: operator.organizationId,
      provider: 'GOOGLE_WORKSPACE',
      connectedEmail,
      // Deliberately not a real credential. `resolve()` never reaches the decrypt for this
      // deployment — it returns NotConfigured at the missing-OAuth-app branch first — and a test
      // that needed a real refresh token would be a test that cannot run on a laptop.
      oauthRefreshTokenEnc: 'v1:not-a-real-credential',
      status: 'ACTIVE',
      connectedByUserId: operator.userId,
    },
    select: { id: true },
  });
  return row.id;
}

async function removeProviderMailbox(id: string) {
  await rawPrisma.organizationEmailIntegration.deleteMany({ where: { id } });
}

describe('decision 25 — the invitation channel', () => {
  it("(c) resolves the PROVIDER's mailbox, identified by its connected address, not the invited company's", async () => {
    const connectedEmail = `${unique('provider-mailbox')}@example.test`;
    const integrationId = await connectProviderMailbox(connectedEmail);
    try {
      const company = await registerCompany();
      const before =
        await rawPrisma.organizationEmailIntegration.findUniqueOrThrow({
          where: { id: integrationId },
          select: {
            lastSucceededAt: true,
            lastFailedAt: true,
            lastError: true,
          },
        });

      // The company has none — the whole point. Asserted, or the test below proves nothing about
      // WHICH mailbox resolved.
      const companyIntegrations =
        await rawPrisma.organizationEmailIntegration.count({
          where: { organizationId: company.id },
        });
      expect(companyIntegrations).toBe(0);

      const response = await request(app.getHttpServer())
        .post(`/provider/insurance-companies/${company.id}/administrator`)
        .set(...bearerHeader(operator.accessToken))
        .send({
          email: `${unique('admin')}@example.test`,
          fullName: 'Company Administrator',
          reason:
            'Decision 25 — the send must leave from the provider mailbox.',
        })
        .expect(201);

      // THE ADDRESS. The outcome was recorded against the row whose connectedEmail is the
      // provider's, which is only reachable if `resolve()` ran in the PROVIDER's context.
      const after =
        await rawPrisma.organizationEmailIntegration.findUniqueOrThrow({
          where: { id: integrationId },
          select: {
            connectedEmail: true,
            lastSucceededAt: true,
            lastFailedAt: true,
            lastError: true,
          },
        });
      expect(after.connectedEmail).toBe(connectedEmail);
      expect(
        after.lastSucceededAt?.getTime() !==
          before.lastSucceededAt?.getTime() ||
          after.lastFailedAt?.getTime() !== before.lastFailedAt?.getTime() ||
          after.lastError !== before.lastError,
        'the provider mailbox row recorded no send outcome, so the send resolved some other ' +
          'integration — or none, which is what happens when it runs inside runAs(companyId)',
      ).toBe(true);

      // And the company still has no integration: nothing was created on its behalf.
      expect(
        await rawPrisma.organizationEmailIntegration.count({
          where: { organizationId: company.id },
        }),
      ).toBe(0);

      const invited = response.body as Invited;
      expect(invited.invitation.outcome).not.toBe('SENT');
    } finally {
      await removeProviderMailbox(integrationId);
    }
  });

  it('(d) with NO provider mailbox the account is created and the invitation is NOT reported as sent', async () => {
    /*
     * `OutboundEmailService`'s own rule with teeth. The account exists, the link was issued, and
     * nothing reached the person — and the route says so rather than returning a bare 201 the
     * screen would render as success.
     */
    const anyProviderMailbox =
      await rawPrisma.organizationEmailIntegration.count({
        where: { organizationId: operator.organizationId },
      });
    expect(
      anyProviderMailbox,
      'the provider has a mailbox row, so NOT_CONFIGURED would be proven for the wrong reason',
    ).toBe(0);

    const company = await registerCompany();
    const response = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason: 'Decision 25 — an unsent invitation must say so.',
      })
      .expect(201);

    const invited = response.body as Invited;
    expect(invited.invitation.outcome).toBe('NOT_CONFIGURED');
    expect(invited.invitation.fromAddress).toBeNull();

    // THE ACCOUNT EXISTS ANYWAY. Reporting a failure by not creating it would be worse: the
    // provider would retry and the second attempt would collide.
    const user = await rawPrisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      select: { organizationId: true, isActive: true },
    });
    expect(user.organizationId).toBe(company.id);
    expect(user.isActive).toBe(true);

    // The link WAS issued, so the dev gate can still open it and a later re-send has something to
    // replace. One token, for this user, unused.
    const tokens = await rawPrisma.passwordResetToken.findMany({
      where: { userId: invited.userId },
      select: { usedAt: true, expiresAt: true },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].usedAt).toBeNull();
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('(f) no password value is returned by the route, in any spelling, and the account must change it', async () => {
    const company = await registerCompany();
    const response = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason: 'Decision 25 — nobody handles a credential, including us.',
      })
      .expect(201);

    const invited = response.body as Invited;
    const body = JSON.stringify(response.body);

    /*
     * AN EXACT KEY SET at the top level, because a leak arrives as an ADDITION and every
     * `not.toHaveProperty` keeps passing while one appears.
     */
    expect(Object.keys(response.body as object).sort()).toEqual(
      [
        'companyId',
        'email',
        'howTheySignIn',
        'invitation',
        'roleName',
        'userId',
      ].sort(),
    );
    expect(Object.keys(invited.invitation).sort()).toEqual(
      ['devInvitationToken', 'fromAddress', 'outcome'].sort(),
    );
    for (const spelling of [
      'password',
      'Password',
      'temporaryPassword',
      'initialPassword',
      'passwordHash',
      'credential',
      'secret',
    ]) {
      expect(body).not.toContain(spelling);
    }

    // The stored hash is unreachable AND unusable: the account must change it before any screen.
    const user = await rawPrisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      select: { mustChangePassword: true },
    });
    expect(user.mustChangePassword).toBe(true);
  });

  it('(h) the invitation audit row carries the template kind and the outcome, and NEITHER the token nor the link', async () => {
    const company = await registerCompany();
    const response = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason: 'Decision 25 — the log records the act, never the credential.',
      })
      .expect(201);

    const invited = response.body as Invited;
    const rows = await rawPrisma.auditLogEntry.findMany({
      where: { entityType: 'User', entityId: invited.userId },
      select: { afterValue: true, action: true },
    });
    expect(rows).toHaveLength(1);
    const after = rows[0].afterValue as Record<string, unknown>;
    expect(after.invitationTemplateKind).toBe(
      'organization_administrator_invitation',
    );
    expect(after.invitationOutcome).toBe(invited.invitation.outcome);

    /*
     * THE ABSENCE IS ASSERTED, not merely unwritten. `AuditLogEntry` is append-only by trigger, so
     * a link that lands there is a credential-equivalent nothing can withdraw — and the token is
     * the whole of what the link is for.
     */
    const serialised = JSON.stringify(after);
    expect(serialised).not.toContain('token');
    expect(serialised).not.toContain('reset-password');
    expect(serialised).not.toContain('setPasswordUrl');
    expect(serialised).not.toContain('http');

    // And the outbound-email row beside it follows the same rule it always did.
    const emailRows = await rawPrisma.auditLogEntry.findMany({
      where: { entityType: 'OutboundEmail' },
      orderBy: { occurredAt: 'desc' },
      take: 1,
      select: { afterValue: true },
    });
    const emailAfter = JSON.stringify(emailRows[0].afterValue);
    expect(emailAfter).toContain('organization_administrator_invitation');
    expect(emailAfter).not.toContain('subject');
    expect(emailAfter).not.toContain('reset-password');
  });

  it('(e) RE-INVITING AN ORGANIZATION NOBODY HAS ENTERED leaves exactly one account, one role and one live token', async () => {
    /*
     * DECISION 26 — THE LOCKOUT CURE, and the three counts the decision asks the state to be in
     * afterwards. Asserted together because any one alone would pass against a re-invitation that
     * quietly created a second account, a second grant, or left the earlier link working.
     *
     * The earlier token being DEAD is the one worth saying out loud: two live links to one account
     * means the first one somebody forwards still works, which is a standing key nobody can
     * withdraw.
     *
     * This test REPLACES one that pinned the refusal as unreachable — written last commit so that
     * whoever lifted it did so deliberately. This is that lift.
     */
    const company = await registerCompany();
    const first = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'First Attempt',
        reason: 'The first invitation, which expired unopened.',
      })
      .expect(201);
    const firstInvited = first.body as Invited;
    const firstTokens = await rawPrisma.passwordResetToken.findMany({
      where: { userId: firstInvited.userId },
      select: { id: true },
    });
    expect(firstTokens).toHaveLength(1);

    const again = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('corrected')}@example.test`,
        fullName: 'Corrected Address',
        reason: 'Re-inviting after the first link expired unopened.',
      })
      .expect(201);

    // THE SAME ACCOUNT, not a new one — which is what makes the three counts below possible.
    expect((again.body as Invited).userId).toBe(firstInvited.userId);

    // (1) exactly ONE active account
    const accounts = await rawPrisma.user.findMany({
      where: { organizationId: company.id },
      select: { id: true, isActive: true, mustChangePassword: true },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].isActive).toBe(true);
    // Re-asserted rather than assumed: the first screen must still be the change-password step.
    expect(accounts[0].mustChangePassword).toBe(true);

    // (2) exactly ONE role assignment
    expect(
      await rawPrisma.userRoleAssignment.count({
        where: { userId: firstInvited.userId },
      }),
    ).toBe(1);

    // (3) exactly ONE LIVE token, and the earlier one is DEAD rather than merely outnumbered.
    const tokens = await rawPrisma.passwordResetToken.findMany({
      where: { userId: firstInvited.userId },
      select: { id: true, usedAt: true, expiresAt: true },
    });
    const live = tokens.filter(
      (t) => t.usedAt === null && t.expiresAt.getTime() > Date.now(),
    );
    expect(
      live,
      'more than one live link to the same account — the earlier one is a standing key nobody can withdraw',
    ).toHaveLength(1);
    expect(live[0].id).not.toBe(firstTokens[0].id);
  });

  it('(e5) REFUSES once the invited account has SET A PASSWORD, even having never signed in', async () => {
    /*
     * THE FIFTH ASSERTION, and it closes a window `lastLoginAt` alone leaves open.
     *
     * Somebody opens the link and sets a password, then closes the browser. `lastLoginAt` is still
     * null — `AuthService.resetPassword` returns `void` and issues no session — so on that fact
     * alone the organization still reads as never-entered, and a re-invitation to a CORRECTED
     * address would SILENTLY cost that person the password they had just chosen. Recoverable, and
     * silent, and the provider would have no way to know they had done it.
     *
     * `User.passwordUpdatedAt` closes it at no cost: nullable with NO default (measured off the
     * database, not the schema file), not written by either invitation service's `tx.user.create`,
     * and written by `UserRepository.updatePassword` — which is exactly what `resetPassword` calls
     * — at the moment the link is used.
     */
    const company = await registerCompany();
    const first = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Set A Password',
        reason: 'The first invitation, which this person opened.',
      })
      .expect(201);
    const invited = first.body as Invited;

    /*
     * The state after using the link, written directly: `passwordUpdatedAt` set, `lastLoginAt`
     * still null. The second half is the NON-VACUITY FLOOR — if `lastLoginAt` were set too, this
     * would be the entered case again and would prove nothing about the new field.
     */
    await rawPrisma.user.update({
      where: { id: invited.userId },
      data: { passwordUpdatedAt: new Date() },
    });
    const row = await rawPrisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      select: { lastLoginAt: true, passwordUpdatedAt: true },
    });
    expect(
      row.lastLoginAt,
      'lastLoginAt is set, so this is the entered case and says nothing about passwordUpdatedAt',
    ).toBeNull();
    expect(row.passwordUpdatedAt).not.toBeNull();

    const refused = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('corrected')}@example.test`,
        fullName: 'Corrected Address',
        reason:
          'A re-invitation that would silently discard a password somebody chose.',
      })
      .expect(409);
    expect(JSON.stringify(refused.body)).toContain('FIRST administrator');

    // And the account keeps the address and the password moment it had.
    const after = await rawPrisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      select: { email: true, passwordUpdatedAt: true },
    });
    expect(after.email).toBe(invited.email);
    expect(after.passwordUpdatedAt).not.toBeNull();
  });
});

/* =============================================================================================
 * REFUSAL 3's PROTECTION, PINNED BEFORE THE LOCKOUT CURE WAS BUILT.
 *
 * The cure opens this route for an organization NO HUMAN HAS EVER ENTERED — a registration that
 * did not complete. What must not move is the thing the refusal was written for: the provider does
 * not become a standing capability to add accounts to a LIVE organization.
 *
 * This file's tests were written and run BEFORE that opening existed, against the blanket
 * `existing > 0` refusal, so that the protection is judged on its own terms rather than shaped by
 * the code that came next.
 * ============================================================================================= */

describe('refusal 3 — the protection, which the lockout cure must not touch', () => {
  it('REFUSES once an account in the organization HAS BEEN ENTERED, with its own message', async () => {
    /*
     * "Entered" is a STORED FACT, not an inference from current state: `User.lastLoginAt`.
     *
     * MEASURED before keying anything on it — one write, one caller:
     *   `UserRepository.recordSuccessfulLogin` (user.repository.ts:724)
     *   called only from `AuthService.issueSession` (auth.service.ts:962).
     * And `issueSession` is reached only after every gate: `mustChangePassword` returns
     * MUST_CHANGE_PASSWORD with an onboarding token and NO session; an unskipped MFA challenge
     * returns `mfaRequired` with NO session. So somebody who proved a password and then failed MFA
     * reads as NOT entered, which is the failure direction the brief warned about and it does not
     * occur.
     *
     * NOT `mustChangePassword`: `UserRepository.markOnboardingRequired` sets it on ANY existing
     * account by id, so a condition keyed on that flag would open this route into a LIVE
     * organization whose administrator happens to be re-enrolling a second factor.
     */
    const company = await registerCompany();
    const email = `${unique('admin')}@example.test`;
    const first = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email,
        fullName: 'Company Administrator',
        reason: 'The first invitation, which this person then used.',
      })
      .expect(201);
    const invited = first.body as Invited;

    /*
     * THE ACCOUNT IS MARKED AS HAVING SIGNED IN, written directly rather than by authenticating.
     *
     * Signing in for real inside a fixture organization writes an `AuditLogEntry` into that
     * tenant, `AuditLogEntry_organizationId_fkey` is ON DELETE RESTRICT and the table refuses
     * DELETE by trigger — ONE row makes the organization permanent. This file's header records two
     * offices stranded in db-test learning that. So the STORED FACT is set directly; what is under
     * test is the route's reading of it, not the login flow that writes it.
     */
    await rawPrisma.user.update({
      where: { id: invited.userId },
      data: { lastLoginAt: new Date() },
    });

    const refused = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email,
        fullName: 'Company Administrator',
        reason:
          'A second invitation into an organization somebody already runs.',
      })
      .expect(409);

    const message = JSON.stringify(refused.body);
    // ITS OWN MESSAGE, unchanged: the sentence is what tells the provider this is not a capability
    // they have, rather than a transient failure to retry.
    expect(message).toContain('FIRST administrator');
    expect(message).toContain('administers itself');
    expect(message).toContain('POST /admin/users');

    // And nothing was created by the refused request.
    expect(
      await rawPrisma.user.count({ where: { organizationId: company.id } }),
      'the refused invitation created a second account',
    ).toBe(1);
  }, 120_000);

  it('REFUSES when ANY account has been entered, not only the invited one', async () => {
    /*
     * The condition is about the ORGANIZATION, not about one row. An organization where a second
     * person has signed in is live even if the first administrator never did — and an opening keyed
     * on the invited account alone would reach exactly that case.
     */
    const company = await registerCompany();
    const first = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason: 'The first invitation, never used by this person.',
      })
      .expect(201);
    const invited = first.body as Invited;

    // A SECOND account in the same organization, which HAS been entered. The invited one has not.
    const role = await rawPrisma.role.findFirstOrThrow({
      where: { organizationId: company.id },
      select: { id: true },
    });
    const second = await rawPrisma.user.create({
      data: {
        organizationId: company.id,
        email: `${unique('second')}@example.test`,
        fullName: 'Somebody Else',
        passwordHash: 'not-a-real-hash',
        lastLoginAt: new Date(),
      },
      select: { id: true },
    });
    await rawPrisma.userRoleAssignment.create({
      /*
       * `organizationId` SPELLED OUT. It is `@default(dbgenerated())`, filled from
       * `app.current_org_id` by the tenancy extension — and `rawPrisma` sets no tenancy, so Prisma
       * sends no value and the NOT NULL column refuses. Measured, not guessed: the first version
       * omitted it and failed with `Null constraint violation on the fields: (organizationId)`.
       */
      data: {
        userId: second.id,
        roleId: role.id,
        organizationId: company.id,
      },
    });

    const invitedRow = await rawPrisma.user.findUniqueOrThrow({
      where: { id: invited.userId },
      select: { lastLoginAt: true },
    });
    expect(
      invitedRow.lastLoginAt,
      'the invited account has been entered, so this test is about the wrong thing',
    ).toBeNull();

    await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `${unique('admin')}@example.test`,
        fullName: 'Company Administrator',
        reason:
          'An invitation into an organization somebody else already runs.',
      })
      .expect(409);
  }, 120_000);
});
