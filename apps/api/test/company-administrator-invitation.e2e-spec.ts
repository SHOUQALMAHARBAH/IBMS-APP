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

  await rawPrisma.userRoleAssignment.deleteMany({ where: { organizationId } });
  await rawPrisma.user.deleteMany({ where: { organizationId } });
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

  it('refuses a second invite — this bootstraps an empty company once, it is not a standing capability', async () => {
    const company = await registerCompany();
    const body = {
      email: `${unique('first')}@example.test`,
      fullName: 'First Administrator',
      reason: 'The first account for this company.',
    };
    await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send(body)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/provider/insurance-companies/${company.id}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({ ...body, email: `${unique('second')}@example.test` })
      .expect(409);

    const message = JSON.stringify(second.body);
    expect(message).toContain('FIRST administrator');
    expect(message).toContain('POST /admin/users');
    // DECISION 90 — no database artefact is ever the error message.
    expect(message).not.toMatch(/violates|constraint|23505|P2002/);
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
