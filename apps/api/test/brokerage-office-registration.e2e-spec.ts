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
  deleteFixtureUsersInOrganization,
  deleteOrganizationCascade,
  rawPrisma,
} from './tenant-prisma';
import { OFFICE_ADMINISTRATOR_GRANTS } from '../src/modules/provider/office-administrator-grants';
import { OrgContextService } from '../src/common/org-context/org-context.service';
import { UserAdminService } from '../src/modules/rbac/services/user-admin.service';
import { DEFAULT_BRANCH, DEFAULT_DEPARTMENT } from '@ibms/db';

/**
 * MODULE 0-ب ITEM (d) — REGISTERING A BROKERAGE OFFICE, over real HTTP.
 *
 * ## THE FOUR REFUSALS ARE DEMONSTRATED, NOT ASSERTED
 *
 * The owner's instruction, and the distinction is the one this repository has been bitten by: a
 * test that asserts "the service refuses" against a mock asserts the mock. Each of the four below
 * sends a real request that a real office administrator could send by mistake, and reads the real
 * answer — and each asserts WHICH refusal, by status and by the sentence's own substance, because a
 * 4xx that could be any of four refusals tells a reader nothing about which control fired.
 *
 * The fourth is the interesting one: it is NOT a refusal. Capital below art. 4/a's summed
 * requirement is reported and the office is registered, and the test asserts BOTH halves — the
 * shortfall is on the response AND the office exists. A test that only checked the shortfall would
 * pass against an implementation that also blocked.
 *
 * ## TEARDOWN IS NOT OPTIONAL HERE, AND IT IS THE RISKIEST PART OF THIS FILE
 *
 * db-test is cumulative, and `createTestApp` asserts there is EXACTLY ONE brokerage office —
 * `soleOrganizationIdOrThrow` counts them, and signup 500s with two. A registered office left behind
 * does not fail this spec; it fails every spec that runs afterwards, in a way that reads as an
 * unrelated fault. Three more guards count the set of organizations for their own reasons
 * (`organization-type`, `office-administrator`, `role-security-attributes`).
 *
 * So every office this file creates is recorded as it is created and deleted in FK order at the end,
 * whether the tests passed or not.
 */

let app: INestApplication<App>;
let operator: { accessToken: string; userId: string; organizationId: string };
const createdOrganizationIds: string[] = [];

/** Reference rows, read from the seeded catalogues rather than invented. */
let legalFormId: string;
let soleEstablishmentId: string;
let licensingAuthorityId: string;
let countryId: string;
let cityId: string;
let bankId: string;
let currencyId: string;
let generalLineIds: string[];
let defaultOfficeId: string;
let lifeLineId: string;

/** Run-unique, because a fixed identifier passes once and 409s forever after in a cumulative
 *  database — the lesson item (g) paid a full run to learn. */
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let seq = 0;
const unique = (prefix: string) => `${prefix}${RUN}${seq++}`;

function validOffice(over: Record<string, unknown> = {}) {
  return {
    code: unique('OFF'),
    legalName: 'Test Brokerage Office',
    legalNameAr: 'مكتب وساطة للاختبار',
    legalFormId,
    nationalEstablishmentNo: unique('NAT'),
    commercialRegistrationNo: unique('CR'),
    taxNumber: unique('TAX'),
    subdomain: `off-${RUN}-${seq++}`.toLowerCase(),
    brokerageKind: 'DIRECT',
    brokerKind: 'CORPORATE',
    licenseNumber: unique('CBJ-L'),
    licensingAuthorityId,
    licenseIssuedAt: '2026-03-01',
    licenseExpiresAt: '2028-12-31',
    certificateFileName: 'cbj-licence.pdf',
    certificateStorageRef: 'not-a-real-store/cbj-licence.pdf',
    licensedLineIds: generalLineIds.slice(0, 2),
    countryId,
    cityId,
    address: 'Amman, Jordan',
    phone: '+962790000000',
    email: `office-${RUN}@example.test`,
    generalManagerName: 'Test Manager',
    complianceOfficerName: 'Test Compliance Officer',
    complianceOfficerEmail: `compliance-${RUN}@example.test`,
    piPolicyNumber: unique('PI'),
    piInsurerName: 'Test Insurance Company',
    piCoverageLimit: '250000.000',
    piExpiresAt: '2027-12-31',
    bankId,
    iban: 'JO94CBJO0010000000000131000302',
    currencyId,
    ...over,
  };
}

/**
 * Deletes one registered office and everything hanging off it, in FK order.
 *
 * SHARED BY THE ENTRY SWEEP AND THE TEARDOWN, and the entry sweep is not belt-and-braces — it is how
 * this file heals itself. `createTestApp`'s own refusal says so: a spec that creates organizations
 * sweeps on entry, BEFORE the app is built, because its `afterAll` is exactly what cannot be relied
 * on. Measured here rather than assumed: the nested `afterAll` in this file threw once, which
 * aborted the file-level one and left two brokerage offices behind — after which EVERY spec in the
 * run refused with a message about signup, naming a fault that was not theirs.
 */
async function deleteOffice(organizationId: string) {
  /*
   * THE LIST BELOW IS EXACTLY WHAT REGISTRATION WRITES, and this assertion is what keeps that true.
   *
   * A USER inside a registered office makes the office PERMANENT: signing in writes `AuditLogEntry`
   * rows, that table is append-only by trigger, and `AuditLogEntry_organizationId_fkey` is RESTRICT
   * — so neither the rows nor the office can be removed by any ordinary route. It happened once in
   * this file, when the boundary test resolved "a brokerage office" by type and picked one of this
   * run's own registrations; seven offices then had to be cleared out of db-test by hand.
   *
   * Failing HERE, by name, is what stops that recurring as an FK error in a teardown three changes
   * from now.
   */
  /*
   * RE-POINTED FROM "no user" TO "no AUDIT ROW", and the distinction is what item (f) exposed.
   *
   * This guard used to refuse any user inside a registered office, on the reasoning that signing in
   * writes append-only audit rows and the office then cannot be deleted. The CONSEQUENCE was exactly
   * right; the KEY was a proxy. Item (f)'s invite creates a user inside a registered office BY
   * DESIGN — that is the capability — and auditing it in the provider's log rather than the office's
   * means the office stays deletable. So the guard now checks the thing that actually strands an
   * office, and the users it used to forbid are deleted below.
   *
   * What makes an office permanent, measured: `AuditLogEntry_organizationId_fkey` is
   * `ON DELETE RESTRICT`, and DELETE on `AuditLogEntry` is refused outright by the
   * `audit_log_entry_no_delete` trigger. So ONE audit row is enough, forever. Two offices were
   * stranded in db-test proving it, and clearing them needed the trigger disabled and re-enabled by
   * hand — which is why this guard is keyed on the real cause now.
   *
   * SIGNING IN still strands an office (it writes audit rows into the office's own tenant), so
   * nothing here may authenticate AS an invited administrator.
   */
  const auditRows = await rawPrisma.auditLogEntry.count({
    where: { organizationId },
  });
  expect(
    auditRows,
    `registered office ${organizationId} carries ${auditRows} audit row(s), so it can NEVER be deleted — the FK is ON DELETE RESTRICT and the table refuses DELETE by trigger. Every later spec in this run will then refuse at createTestApp with a fault that looks like its own. Nothing in this file may SIGN IN as a user inside an office it registered, and nothing may audit into one`,
  ).toBe(0);

  /*
   * The users item (f) invites. Deletable precisely because nothing audited into this office — and
   * through the SHARED helper, because decision 25's invitation now issues a `PasswordResetToken`
   * whose FK is not a cascade. Spelled out here it threw, the office leaked, and every later spec
   * in the run failed at `createTestApp` with a fault that was not its own.
   */
  await deleteFixtureUsersInOrganization(organizationId);

  const licenses = await rawPrisma.brokerLicense.findMany({
    where: { organizationId },
    select: { id: true, certificateDocumentId: true },
  });
  await rawPrisma.brokerLicenseScopeLine.deleteMany({
    where: { brokerLicenseId: { in: licenses.map((l) => l.id) } },
  });
  await rawPrisma.brokerLicense.deleteMany({ where: { organizationId } });
  await rawPrisma.document.deleteMany({
    where: { id: { in: licenses.map((l) => l.certificateDocumentId) } },
  });
  /*
   * THE REGISTRATION PACK'S POINTERS SIT ON THE PARENT, so they have to be released before their
   * documents can go. `Document_organizationId_fkey` is RESTRICT, so a document left behind makes the
   * office undeletable and every later spec in this run refuses with a fault that is not its own —
   * which is exactly what happened on this witness's first run.
   *
   * Nulling the columns and THEN deleting is the order; deleting first hits
   * `Organization_premisesTenureDocumentId_fkey`, also RESTRICT.
   */
  await rawPrisma.organization.updateMany({
    where: { id: organizationId },
    data: {
      premisesTenureDocumentId: null,
      associationMembershipDocumentId: null,
    },
  });
  /*
   * THIS LINE IS WHAT GUARANTEES IT, not the by-id delete above — do not tidy it away as redundant.
   * The by-id delete remembers a pointer; this one clears the state, which is the only form that can
   * repair a run killed between nulling a pointer and deleting its document. The sibling company
   * spec had exactly the pointer-remembering shape and left five undeletable organizations in
   * db-test, after which every later run's entry sweep failed on the first of them.
   */
  await rawPrisma.document.deleteMany({ where: { organizationId } });
  await rawPrisma.professionalIndemnityPolicy.deleteMany({
    where: { organizationId },
  });
  await rawPrisma.rolePermission.deleteMany({ where: { organizationId } });
  await rawPrisma.role.deleteMany({ where: { organizationId } });
  // Branch and Department now BLOCK this delete — see `deleteOrganizationCascade`.
  await deleteOrganizationCascade(organizationId);
}

beforeAll(async () => {
  // THE ENTRY SWEEP, before the app exists. Every office this file has ever created carries a
  // subdomain beginning `off-`, which nothing else in this product uses.
  const leftovers = await rawPrisma.organization.findMany({
    where: { type: 'BROKERAGE_OFFICE', subdomain: { startsWith: 'off-' } },
    select: { id: true },
  });
  for (const leftover of leftovers) await deleteOffice(leftover.id);

  app = await createTestApp();
  operator = await createProviderUser(app, 'provider-office-registration');

  const [legalForms, authority, country, city, bank, currency, lines] =
    await Promise.all([
      rawPrisma.legalForm.findMany({ select: { id: true, code: true } }),
      rawPrisma.licensingAuthority.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.country.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.city.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.bank.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.currency.findFirstOrThrow({ where: { code: 'JOD' } }),
      rawPrisma.insuranceLine.findMany({
        select: { id: true, category: true },
      }),
    ]);

  legalFormId = legalForms[0].id;
  soleEstablishmentId =
    legalForms.find((f) => f.code === 'SOLE_ESTABLISHMENT')?.id ??
    legalForms[0].id;
  licensingAuthorityId = authority.id;
  countryId = country.id;
  cityId = city.id;
  bankId = bank.id;
  currencyId = currency.id;
  generalLineIds = lines
    .filter((l) => l.category === 'GENERAL')
    .map((l) => l.id);
  lifeLineId = lines.filter((l) => l.category === 'LIFE')[0].id;

  // Captured BEFORE any registration, so "the brokerage office" cannot resolve to one of this file's
  // own. Resolving by type alone picked a registered office once and made it permanent.
  defaultOfficeId = (
    await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true },
    })
  ).id;

  // Non-vacuity on the FIXTURE, not only on the assertions: every refusal below would still "pass"
  // if the catalogue read came back empty, because the request would fail for a different reason.
  expect(generalLineIds.length).toBeGreaterThan(1);
  expect(lifeLineId).toBeTruthy();
}, 300_000);

afterAll(async () => {
  for (const organizationId of createdOrganizationIds) {
    await deleteOffice(organizationId);
  }

  // THE ASSERTION THAT MAKES THE TEARDOWN A GUARANTEE RATHER THAN A HOPE. One brokerage office is
  // what every later spec in this run assumes, and a silent teardown failure would surface as an
  // unrelated 500 in a file nobody has touched.
  const offices = await rawPrisma.organization.count({
    where: { type: 'BROKERAGE_OFFICE' },
  });
  expect(
    offices,
    'this spec left a brokerage office behind. `createTestApp` asserts exactly one, so every later spec in this run will fail with a fault that looks like its own',
  ).toBe(1);

  await app?.close();
}, 300_000);

/**
 * The response shapes, declared.
 *
 * `any` on a response body is a lint ERROR in this workspace and the rule is load-bearing: the last
 * time it was relaxed, six `not.toHaveProperty` assertions were running against `undefined` and
 * every one of them passed.
 */
interface RegistrationBody {
  id: string;
  licensedTypes: string[];
  capital: {
    requiredCapital: string;
    paidUpCapital: string | null;
    shortfall: string | null;
    meetsRequirement: boolean;
    capitalIsUnrecorded: boolean;
  };
}
interface ErrorBody {
  message: string | string[];
}

/** Registers and records the id for teardown, so a test cannot forget. */
async function register(body: Record<string, unknown>) {
  const response = await request(app.getHttpServer())
    .post('/provider/brokerage-offices')
    .set(...bearerHeader(operator.accessToken))
    .send(body);
  const registered = response.body as Partial<RegistrationBody>;
  if (response.status === 201 && typeof registered.id === 'string') {
    createdOrganizationIds.push(registered.id);
  }
  return response;
}

describe('the provider registers a brokerage office', () => {
  it('creates the office, its licence term, its scope and its administrator role', async () => {
    const response = await register(validOffice());
    expect(response.status).toBe(201);

    const { id: organizationId } = response.body as RegistrationBody;
    const organization = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    expect(organization.type).toBe('BROKERAGE_OFFICE');
    expect(organization.brokerKind).toBe('CORPORATE');
    expect(organization.brokerageKind).toBe('DIRECT');
    // The licence TYPES are derived from the branches and never stored — decision 67. Two general
    // lines, so one type.
    expect((response.body as RegistrationBody).licensedTypes).toEqual([
      'GENERAL',
    ]);

    // The IBAN is encrypted at rest. Asserted on the stored value rather than on a flag, because a
    // flag reports an intention and the column is the fact.
    expect(organization.ibanEnc).toBeTruthy();
    expect(organization.ibanEnc).not.toContain('JO94CBJO');

    const license = await rawPrisma.brokerLicense.findFirstOrThrow({
      where: { organizationId },
      include: { scopeLines: true },
    });
    expect(license.certificateDocumentId).toBeTruthy();
    expect(license.scopeLines).toHaveLength(2);

    const pi = await rawPrisma.professionalIndemnityPolicy.findFirstOrThrow({
      where: { organizationId },
    });
    expect(pi.policyNumber).toBeTruthy();
  });

  it("gives it an administrator whose grants are the CATALOGUE's, not another office's", async () => {
    const response = await register(validOffice());
    expect(response.status).toBe(201);

    const role = await rawPrisma.role.findFirstOrThrow({
      where: {
        organizationId: (response.body as RegistrationBody).id,
        name: 'OFFICE_ADMINISTRATOR',
      },
      include: { permissions: { include: { permission: true } } },
    });

    /*
     * BOTH GUARDS, as the owner asked for, and they catch different things.
     *
     * The COUNT catches a partial write — a `createMany` that wrote some rows, or a resolution that
     * silently found fewer permissions than it asked for.
     *
     * The NAMED SET catches the thing a count cannot: 45 grants where one code was swapped for
     * another.
     *
     * WHAT NEITHER CAN SEE, stated so a green run is not read as more than it is: both compare the
     * role against `OFFICE_ADMINISTRATOR_GRANTS`, so a wrong DECLARATION moves both sides together
     * and passes. Proven by planting exactly that — editing the constant killed nothing. The
     * declaration is checked against the seed grid in
     * `packages/db/prisma/office-administrator-grants.parity.spec.ts`, which is the only place that
     * can see both. That is the standing rule on this branch, and the reason it exists is that a count is
     * satisfied by any 45 — including 45 that give a brand-new office's administrator a capability
     * nobody decided it should have.
     */
    expect(role.permissions).toHaveLength(OFFICE_ADMINISTRATOR_GRANTS.length);
    expect(
      role.permissions.map((rp) => rp.permission.code).sort(),
      "the new office's administrator does not hold the declared grant set",
    ).toEqual([...OFFICE_ADMINISTRATOR_GRANTS].sort());

    // AND NOT COPIED FROM ANOTHER OFFICE. The default office's administrator is the row a
    // copy-based implementation would have replayed; this asserts the new office's set is the
    // DECLARED one even if that office has drifted away from it.
    const defaultOfficeAdmin = await rawPrisma.role.findFirst({
      where: {
        name: 'OFFICE_ADMINISTRATOR',
        organizationId: { not: (response.body as RegistrationBody).id },
      },
      include: { permissions: { include: { permission: true } } },
    });
    expect(
      defaultOfficeAdmin,
      'there is no other office administrator to compare against, so this assertion proves nothing — check the seed',
    ).toBeTruthy();
  });
});

describe('the four refusals', () => {
  it('REFUSAL 1 — the same national establishment number twice', async () => {
    const first = validOffice();
    expect((await register(first)).status).toBe(201);

    const second = await register(
      validOffice({ nationalEstablishmentNo: first.nationalEstablishmentNo }),
    );
    expect(second.status).toBe(409);
    // WHICH refusal, not merely that one happened. Three different 409s are reachable from this
    // route (establishment number, code, subdomain) and a bare status cannot tell them apart.
    const secondBody = second.body as ErrorBody;
    expect(String(secondBody.message)).toContain(first.nationalEstablishmentNo);
    expect(String(secondBody.message)).toMatch(/already registered/i);
  });

  it('REFUSAL 1b — and across ORGANIZATION TYPES, not only among offices', async () => {
    /*
     * The half that would be easy to miss. An establishment registered as a brokerage office must
     * not be registerable again as an insurance company — which is why the unique index is on
     * `Organization` rather than on anything type-specific.
     *
     * Item (e) builds the insurer registration route; until it exists the insurer side is written
     * directly, which is the honest way to prove the CONSTRAINT rather than a service that is not
     * written yet. The failure asserted is the DATABASE's, by SQLSTATE.
     */
    const office = validOffice();
    expect((await register(office)).status).toBe(201);

    let code: string | undefined;
    try {
      await rawPrisma.organization.create({
        data: {
          type: 'INSURANCE_COMPANY',
          legalName: 'Collision Insurance Company',
          legalNameAr: 'شركة تأمين متصادمة',
          subdomain: `collide-${RUN}`,
          nationalEstablishmentNo: office.nationalEstablishmentNo,
        },
      });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(
      code,
      "an INSURANCE_COMPANY was accepted carrying a brokerage office's national establishment number — the unique index is not platform-wide",
    ).toBe('P2002');
  });

  it('REFUSAL 2 — saving without the licence certificate', async () => {
    const { certificateFileName, ...withoutCertificate } = validOffice();
    expect(certificateFileName).toBeTruthy();

    const response = await register(withoutCertificate);
    expect(response.status).toBe(400);
    // Named, because a 400 from this route could be any of thirty fields.
    expect(JSON.stringify((response.body as ErrorBody).message)).toContain(
      'certificateFileName',
    );
  });

  it('REFUSAL 3 — a natural person given two insurance types (art. 3/a)', async () => {
    const response = await register(
      validOffice({
        brokerKind: 'NATURAL_PERSON',
        legalFormId: soleEstablishmentId,
        licensedLineIds: [generalLineIds[0], lifeLineId],
      }),
    );
    expect(response.status).toBe(422);
    // The ARTICLE, not just a refusal. A 422 that does not cite the rule sends Compliance hunting a
    // system fault — the same reason item (c)'s absence gate cites art. 21/a/9 by number.
    const refusal = response.body as ErrorBody;
    expect(String(refusal.message)).toContain('art. 3/a');
    expect(String(refusal.message)).toMatch(
      /GENERAL and LIFE|LIFE and GENERAL/,
    );
  });

  it('REFUSAL 3b — and the SAME office with ONE type is accepted', async () => {
    // The half that proves the refusal is about the rule rather than about natural persons. Without
    // it, an implementation that refused every sole establishment would pass the test above.
    const response = await register(
      validOffice({
        brokerKind: 'NATURAL_PERSON',
        legalFormId: soleEstablishmentId,
        licensedLineIds: [generalLineIds[0], generalLineIds[1]],
      }),
    );
    expect(response.status).toBe(201);
    expect((response.body as RegistrationBody).licensedTypes).toEqual([
      'GENERAL',
    ]);
  });

  it('REFUSAL 4 IS NOT ONE — capital below the requirement is INFORMATION, and the office is registered', async () => {
    /*
     * Art. 4/a: 5,000 JOD per type up to 6 branches. Two general branches, so the requirement is
     * 5,000 and the office records 1,000.
     *
     * BOTH HALVES ARE ASSERTED and that is the whole point. A test that only checked the shortfall
     * would pass against an implementation that reported it AND blocked — which is the version
     * somebody writes when they read art. 4/a as a gate. The office arrives holding a licence the
     * CBJ already granted, so refusing to record it on the strength of our own arithmetic would
     * leave a licensed brokerage unable to exist on the platform at all.
     */
    const response = await register(validOffice({ paidUpCapital: '1000.000' }));
    expect(response.status).toBe(201);
    expect((response.body as RegistrationBody).capital.requiredCapital).toBe(
      '5000.000',
    );
    expect((response.body as RegistrationBody).capital.paidUpCapital).toBe(
      '1000.000',
    );
    expect((response.body as RegistrationBody).capital.shortfall).toBe(
      '4000.000',
    );
    expect((response.body as RegistrationBody).capital.meetsRequirement).toBe(
      false,
    );
    expect(
      (response.body as RegistrationBody).capital.capitalIsUnrecorded,
    ).toBe(false);

    const organization = await rawPrisma.organization.findUnique({
      where: { id: (response.body as RegistrationBody).id },
    });
    expect(
      organization,
      'the office was NOT registered, so art. 4/a is being read as a gate. It is a warning — see requiredCapitalForScope, where the "per type" reading is flagged as one of two defensible ones',
    ).toBeTruthy();
  });

  it('and "no capital recorded" is a DIFFERENT fact from "recorded and short"', async () => {
    // Conflating them would tell an office it is undercapitalised when nobody has typed the number.
    const response = await register(validOffice());
    expect(response.status).toBe(201);
    expect(
      (response.body as RegistrationBody).capital.capitalIsUnrecorded,
    ).toBe(true);
    expect(
      (response.body as RegistrationBody).capital.paidUpCapital,
    ).toBeNull();
    expect((response.body as RegistrationBody).capital.shortfall).toBeNull();
  });
});

describe('the boundary — who may register an office', () => {
  /*
   * ITEM (j)'s THIRD LAYER, PROVEN AGAINST THE ONLY CALLER THAT CAN PROVE IT.
   *
   * THE FIRST VERSION OF THIS TEST PROVED NOTHING, and planting is what showed it. It tried to sign
   * in as a sample account whose password it could not know, fell through to an unauthenticated
   * request, and asserted 401 — which is true whether or not the route checks the organization at
   * all. Dropping the check left all ten tests green.
   *
   * The caller that actually tests the boundary is a BROKERAGE OFFICE user who HOLDS the permission.
   * That state cannot be reached through the application — `setPermissions` refuses a PLATFORM code
   * for a non-provider organization, and the matrix never offers it — so the grant is written
   * directly, which is precisely the threat the route's own check exists for: a grant that arrived
   * by some route other than the one that refuses it.
   */
  let officeRoleId: string | null = null;
  let officeUserId: string | null = null;

  afterAll(async () => {
    /*
     * THE USER IS DEACTIVATED, NOT DELETED, AND THAT IS NOT TIDINESS — IT IS IMPOSSIBLE.
     *
     * Measured by trying it: `rawPrisma.user.deleteMany` fails with SQLSTATE 23001,
     * `AuditLogEntry_userId_fkey` RESTRICT. Signing in and enrolling MFA writes audit rows, and
     * `AuditLogEntry` is append-only BY DATABASE TRIGGER — so the rows cannot be removed either and
     * the user is permanent the moment it does anything.
     *
     * That is the audit trail working exactly as designed, and it is what this product does with a
     * person who leaves: deactivate, revoke, keep the record of what they did. A fixture is held to
     * the same rule. What must not survive is the GRANT — a brokerage office role holding a
     * PLATFORM code would be a real finding for every later spec that reads the grid.
     */
    if (officeUserId) {
      await rawPrisma.userRoleAssignment.deleteMany({
        where: { userId: officeUserId },
      });
      await rawPrisma.userSession.deleteMany({
        where: { userId: officeUserId },
      });
      await rawPrisma.mfaCredential.deleteMany({
        where: { userId: officeUserId },
      });
      await rawPrisma.user.update({
        where: { id: officeUserId },
        data: { isActive: false },
      });
    }
    if (officeRoleId) {
      await rawPrisma.rolePermission.deleteMany({
        where: { roleId: officeRoleId },
      });
      await rawPrisma.role.deleteMany({ where: { id: officeRoleId } });
    }
  }, 300_000);

  it('refuses an office user who HOLDS the permission, and the refusal says why', async () => {
    // The office captured BEFORE any registration — never "a brokerage office", which resolved to
    // one of this file's own registrations once and pinned it permanently.
    const office = { id: defaultOfficeId };
    const permission = await rawPrisma.permission.findUniqueOrThrow({
      where: { code: 'provider.office.register' },
      select: { id: true, scope: true },
    });
    // The grant only means something if the code really is PLATFORM-scoped: on an OFFICE code there
    // would be no boundary to test.
    expect(permission.scope).toBe('PLATFORM');

    const role = await rawPrisma.role.create({
      data: {
        organizationId: office.id,
        name: `E2E_PLATFORM_GRANT_${RUN}`,
        nameEn: 'E2E platform grant',
        nameAr: 'اختبار منح على مستوى المنصّة',
        requiresMfaAlways: true,
      },
      select: { id: true },
    });
    officeRoleId = role.id;
    await rawPrisma.rolePermission.create({
      data: {
        organizationId: office.id,
        roleId: role.id,
        permissionId: permission.id,
      },
    });

    const user = await createUserInOrganization(app, {
      organizationId: office.id,
      roleId: role.id,
      label: 'office-holding-platform-code',
    });
    officeUserId = user.userId;

    const response = await request(app.getHttpServer())
      .post('/provider/brokerage-offices')
      .set(...bearerHeader(user.accessToken))
      .send(validOffice());

    // 403 and not 401: the caller is authenticated and past the permission guard. The ROUTE is what
    // refuses, which is the whole claim.
    expect(response.status).toBe(403);
    // NAMING WHY, rather than an empty response or a bare status. A refusal that reads as a
    // permission problem sends somebody asking for a grant they already hold.
    const boundaryRefusal = response.body as ErrorBody;
    expect(String(boundaryRefusal.message)).toMatch(/platform operator/i);
    expect(String(boundaryRefusal.message)).toMatch(/tenant/i);

    // AND NOTHING WAS WRITTEN. A refusal after a partial write is the failure this route's single
    // transaction exists to prevent, and a status code alone cannot see it.
    const leaked = await rawPrisma.organization.count({
      where: { nationalEstablishmentNo: { startsWith: `NAT${RUN}` } },
    });
    const registered = createdOrganizationIds.length;
    expect(leaked, 'the refused registration left an Organization behind').toBe(
      registered,
    );
  });
});

/**
 * DECISION 88 — THE TWO NON-REFUSALS, over real HTTP.
 *
 * This is the INVERSE SHAPE of every refusal test above and therefore needs its own witness: the
 * claim is that absence does NOT block, which no refusal test can establish. Both halves are asserted
 * together in each case — the office EXISTS and the derived pack names what is missing — because a
 * test asserting only the marker would pass against an implementation that also refused the save.
 */
describe('ITEM (f) — the office gets its FIRST administrator, which is what made item (d) usable', () => {
  /*
   * WITHOUT THIS, ITEM (d) WAS BUILT AND UNREACHABLE. Registration creates the office and its
   * `OFFICE_ADMINISTRATOR` role and NO USER, and both alternatives were measured to fail: signup
   * resolves the platform's SOLE office (and assigns no role anyway), and `POST /admin/users` writes
   * into the CALLER's office because its DTO carries no organization.
   *
   * THESE TESTS ARE ALSO THE ONLY PROOF THE MODULE IS WIRED. The invitation service injects
   * `PasswordService`, which lives in `AuthModule` — a module `ProviderModule` did not import. A
   * missing DI provider COMPILES CLEANLY and fails on the first request, which is the defect item
   * (e) paid for with a 500 on every insurer registration. `npx tsc` passes either way; a request
   * that boots the app is what decides.
   */
  async function invite(officeId: string, over: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`/provider/brokerage-offices/${officeId}/administrator`)
      .set(...bearerHeader(operator.accessToken))
      .send({
        email: `admin-${unique('inv').toLowerCase()}@example.test`,
        fullName: 'المدير المدعو للاختبار',
        reason:
          'First administrator for the office registered in this test run.',
        ...over,
      });
  }

  it('creates the account INSIDE the office, holding that office administrator role', async () => {
    const registered = await register(validOffice());
    expect(registered.status).toBe(201);
    const officeId = (registered.body as RegistrationBody).id;

    const response = await invite(officeId);
    expect(
      response.status,
      `the invite failed: ${JSON.stringify(response.body)}. A 500 here is the DI wiring, not the logic.`,
    ).toBe(201);

    const body = response.body as {
      officeId: string;
      userId: string;
      email: string;
      roleName: string;
      howTheySignIn: string;
    };
    expect(body.officeId).toBe(officeId);
    expect(body.roleName).toBe('OFFICE_ADMINISTRATOR');
    // STATED ON THE RESPONSE, because nothing emails anything: the operator has to be told how the
    // person they just invited actually gets in.
    expect(body.howTheySignIn).toBe('PASSWORD_RESET');

    // THE CROSS-TENANT WRITE LANDED IN THE RIGHT TENANT — read back raw, because the point of the
    // test is WHICH organization the row belongs to, and a scoped read could not tell.
    const user = await rawPrisma.user.findUniqueOrThrow({
      where: { id: body.userId },
      select: {
        organizationId: true,
        email: true,
        mustChangePassword: true,
        isActive: true,
        passwordHash: true,
      },
    });
    expect(user.organizationId).toBe(officeId);
    expect(user.email).toBe(body.email);
    // NO USABLE PASSWORD, and `mustChangePassword` so even a reset lands on the change step.
    expect(user.mustChangePassword).toBe(true);
    expect(user.isActive).toBe(true);
    expect(user.passwordHash.length).toBeGreaterThan(20);

    const assignments = await rawPrisma.userRoleAssignment.findMany({
      where: { userId: body.userId, revokedAt: null },
      select: {
        organizationId: true,
        role: { select: { name: true, organizationId: true } },
      },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].organizationId).toBe(officeId);
    expect(assignments[0].role.name).toBe('OFFICE_ADMINISTRATOR');
    // AND THE ROLE IS THAT OFFICE'S OWN, not another office's row with the same name — the property
    // three-offices-coexist proves from the other direction.
    expect(assignments[0].role.organizationId).toBe(officeId);

    /*
     * AND THE AUDIT ROW IS IN THE PROVIDER'S LOG, NOT THE OFFICE'S — the assertion that keeps this
     * route from stranding an office forever. An audit row inside the office makes it undeletable
     * (`ON DELETE RESTRICT` plus a trigger refusing DELETE), and its actor is a provider user the
     * office's own tenant-scoped lookup cannot resolve. Both halves asserted, because the office
     * half passing is what a correct-looking wrong implementation produces.
     */
    const provider = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'PROVIDER' },
      select: { id: true },
    });
    const inOffice = await rawPrisma.auditLogEntry.count({
      where: { organizationId: officeId },
    });
    expect(
      inOffice,
      'the invitation audited into the OFFICE, which makes that office permanently undeletable',
    ).toBe(0);
    const inProvider = await rawPrisma.auditLogEntry.count({
      where: {
        organizationId: provider.id,
        entityType: 'User',
        entityId: body.userId,
      },
    });
    expect(
      inProvider,
      "the invitation was not audited in the provider's log at all",
    ).toBe(1);
  }, 180_000);

  it('REFUSES a second invitation — this bootstraps an empty office ONCE', async () => {
    /*
     * The refusal that keeps this from becoming a standing provider capability to add accounts to a
     * live office. Asserted on the MESSAGE as well as the status, because a bare 409 would read as a
     * duplicate email rather than "this office administers itself now".
     */
    const registered = await register(validOffice());
    const officeId = (registered.body as RegistrationBody).id;
    expect((await invite(officeId)).status).toBe(201);

    const second = await invite(officeId);
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('FIRST administrator');
    expect(JSON.stringify(second.body)).toContain('POST /admin/users');
  }, 180_000);

  it('REFUSES an organization that is not a brokerage office, naming what it is', async () => {
    // The provider's own id: it has its own operator from the seed, and it is not an office.
    const provider = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'PROVIDER' },
      select: { id: true },
    });
    const response = await invite(provider.id);
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toContain('PROVIDER');
    expect(JSON.stringify(response.body)).toContain('BROKERAGE OFFICE');
  }, 180_000);

  it('REFUSES an id that is not an organization at all — 404, not a silent 403', async () => {
    const response = await invite('00000000-0000-0000-0000-00000000dead');
    expect(response.status).toBe(404);
  }, 180_000);

  it('REFUSES a reason below the floor — a one-word reason is a box ticked', async () => {
    const registered = await register(validOffice());
    const officeId = (registered.body as RegistrationBody).id;
    const response = await invite(officeId, { reason: 'because' });
    expect(response.status).toBe(400);
  }, 180_000);
});

describe('THREE OFFICES COEXIST — the acceptance witness for a multi-office platform', () => {
  /*
   * The close asks for three offices registered, and the question behind that is not "does the route
   * work" — eight tests above already register one each. It is whether three can exist AT THE SAME
   * TIME, which no single-registration test can answer and which several things could quietly
   * forbid: `Organization_one_provider` is a partial unique and a wrongly-written one would have
   * constrained offices too; the administrator role is created per office and a globally-unique role
   * name would collide on the second; and the platform-wide identifier uniques must bind ACROSS
   * offices while letting three distinct offices through.
   *
   * It also asserts each office gets its OWN administrator role, because one shared role would mean
   * office A's administrator could administer office B — the failure this registration route exists
   * to make impossible.
   *
   * ## WHAT A SOURCE PLANT CANNOT DO TO THIS TEST, stated rather than left implied
   *
   * `createAdministratorRole` has NO per-office branch — every office goes through identical code,
   * and the office id arrives from the tenant context rather than from an argument. So there is no
   * one-line substitution that makes the THIRD office behave differently from the first, and the
   * regressions this test is really aimed at are at CONSTRAINT level: a `Role.name` unique written
   * globally instead of per office, or a partial unique like `Organization_one_provider` written so
   * that it constrains offices too. Neither is expressible as a source plant.
   *
   * The attempt is recorded because it taught something: resolving the grants against one hard-coded
   * code made the service's own count guard throw, which killed six tests at their `expect(201)`
   * rather than at anything they assert — a plant that breaks the structure cannot tell you which
   * test observes what. What IS plantable here is the `isSystem` assertion below, which is why it was
   * added.
   */
  it('registers three distinct offices that all exist at once, each with its own administrator', async () => {
    const bodies = [
      validOffice({ legalName: 'First Brokerage Office' }),
      validOffice({ legalName: 'Second Brokerage Office' }),
      validOffice({ legalName: 'Third Brokerage Office' }),
    ];

    const ids: string[] = [];
    for (const body of bodies) {
      const response = await register(body);
      expect(
        response.status,
        `registering office ${ids.length + 1} of 3 failed: ${JSON.stringify(response.body)}`,
      ).toBe(201);
      ids.push((response.body as RegistrationBody).id);
    }

    // DISTINCT ROWS, not one row written three times.
    expect(new Set(ids).size).toBe(3);

    // ALL THREE PRESENT SIMULTANEOUSLY — read back from the database rather than from the three
    // responses that reported them.
    const present = await rawPrisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, legalName: true, type: true, subdomain: true },
    });
    expect(present).toHaveLength(3);
    for (const org of present) expect(org.type).toBe('BROKERAGE_OFFICE');
    expect(new Set(present.map((o) => o.subdomain)).size).toBe(3);

    // AND EACH HAS ITS OWN ADMINISTRATOR ROLE. Three rows, three distinct ids, same name — which is
    // the point: the name is unique PER OFFICE, so a globally-unique name would have failed above.
    const roles = await rawPrisma.role.findMany({
      where: { organizationId: { in: ids }, name: 'OFFICE_ADMINISTRATOR' },
      select: {
        id: true,
        organizationId: true,
        isSystem: true,
        requiresMfaAlways: true,
      },
    });
    expect(roles).toHaveLength(3);
    expect(new Set(roles.map((r) => r.id)).size).toBe(3);
    expect(new Set(roles.map((r) => r.organizationId)).size).toBe(3);

    /*
     * AND EVERY ONE IS `isSystem`, FOR EVERY OFFICE — not just the first.
     *
     * This is the property that makes the witness plantable at all, and it is a real one: `isSystem`
     * is what stops the Role screen renaming, retiring or re-granting this row. An office whose
     * administrator role could be retired can lock itself out of its own user administration, and
     * nothing inside the system can repair that — which is the whole argument the last-administrator
     * lockout guard rests on. `isSystem` grants nothing by itself; it only withholds those three
     * controls.
     *
     * The strict MFA attribute is asserted beside it for the same reason the service states both
     * explicitly rather than inheriting the column defaults: a future change to a default must not
     * silently relax the first administrator of every office registered afterwards.
     */
    for (const role of roles) {
      expect(
        role.isSystem,
        'an office administrator role is not isSystem, so that office can retire its own administrator and lock itself out of user administration with no route back',
      ).toBe(true);
      expect(role.requiresMfaAlways).toBe(true);
    }

    // Each role carries the full declared grant set — not a copy of another office's.
    for (const role of roles) {
      const grants = await rawPrisma.rolePermission.count({
        where: { roleId: role.id },
      });
      expect(grants).toBe(OFFICE_ADMINISTRATOR_GRANTS.length);
    }

    // AND THE PROVIDER IS STILL THE ONLY PROVIDER — the partial unique constrains its own type and
    // nothing else, which is exactly what three coexisting offices prove.
    const providers = await rawPrisma.organization.count({
      where: { type: 'PROVIDER' },
    });
    expect(providers).toBe(1);
  }, 180_000);
});

describe('decision 88 — the two art. 10/a documents do NOT block a save', () => {
  it('registers with NEITHER, and the derived pack NAMES both', async () => {
    const response = await register(validOffice());
    expect(response.status).toBe(201);

    const body = response.body as RegistrationBody & {
      registrationPack: { missing: string[]; complete: boolean };
    };
    // THE SAVE SUCCEEDED — read back from the database, not from the response that reported it.
    const organization = await rawPrisma.organization.findUnique({
      where: { id: body.id },
    });
    expect(
      organization,
      'the office was NOT registered. Decision 88: absence of an art. 10/a document must not block the save — an office licensed by the Central Bank has already submitted these to the regulator',
    ).toBeTruthy();
    expect(organization?.premisesTenureDocumentId).toBeNull();
    expect(organization?.associationMembershipDocumentId).toBeNull();

    // AND THE PACK NAMES BOTH, by name and never by count.
    expect(body.registrationPack.complete).toBe(false);
    expect(body.registrationPack.missing).toEqual([
      'premisesTenure',
      'associationMembership',
    ]);
  }, 180_000);

  it('registers with ONE, and the pack names the REMAINING one alone', async () => {
    const response = await register(
      validOffice({
        premisesTenureFileName: 'lease.pdf',
        premisesTenureStorageRef: 'not-a-real-store/lease.pdf',
      }),
    );
    expect(response.status).toBe(201);

    const body = response.body as RegistrationBody & {
      registrationPack: { missing: string[]; complete: boolean };
    };
    expect(body.registrationPack.missing).toEqual(['associationMembership']);

    const organization = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(organization.premisesTenureDocumentId).toBeTruthy();
    expect(organization.associationMembershipDocumentId).toBeNull();
  }, 180_000);

  it('registers with BOTH, and the pack is complete — the non-empty negative case', async () => {
    const response = await register(
      validOffice({
        premisesTenureFileName: 'lease.pdf',
        premisesTenureStorageRef: 'not-a-real-store/lease.pdf',
        associationMembershipFileName: 'association.pdf',
        associationMembershipStorageRef: 'not-a-real-store/association.pdf',
      }),
    );
    expect(response.status).toBe(201);

    const body = response.body as RegistrationBody & {
      registrationPack: { missing: string[]; complete: boolean };
    };
    expect(body.registrationPack.missing).toEqual([]);
    expect(body.registrationPack.complete).toBe(true);

    const organization = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(organization.premisesTenureDocumentId).toBeTruthy();
    expect(organization.associationMembershipDocumentId).toBeTruthy();
  }, 180_000);

  it('GATES NOTHING — the office registered with neither still gets its administrator role', async () => {
    /*
     * Decision 88 rule 5, asserted rather than assumed. The marker is a marker and a report: it does
     * not block sign-in, role creation, or anything else. The administrator role is the nearest thing
     * this route produces that an office cannot work without, so it is what the assertion reads.
     */
    const response = await register(validOffice());
    expect(response.status).toBe(201);
    const body = response.body as RegistrationBody & {
      registrationPack: { missing: string[] };
      administratorGrantCount: number;
    };
    expect(body.registrationPack.missing.length).toBe(2);
    expect(body.administratorGrantCount).toBe(
      OFFICE_ADMINISTRATOR_GRANTS.length,
    );

    const role = await rawPrisma.role.findFirst({
      where: { organizationId: body.id, name: 'OFFICE_ADMINISTRATOR' },
    });
    expect(
      role,
      'an incomplete pack withheld the administrator role',
    ).toBeTruthy();
  }, 180_000);
});

describe('ITEM 1 HALF B — a newly registered office can provision its FIRST user', () => {
  /*
   * THE EVIDENCE THE OWNER ASKED FOR, in her words: "a test that provisions a user in an
   * organization created by the normal registration path, with no manual branch/department setup,
   * and a negative assertion that the two lists are non-empty on first load."
   *
   * ## WHAT WAS WRONG, AND WHY NO PERMISSION CHANGE COULD FIX IT
   *
   * `provision-user.dto.ts` makes `departmentId` and `branchId` FLATLY REQUIRED. A newly registered
   * office could not create its first user — not because its administrator lacked a code (it holds
   * `branch.read` and `department.read`) but because the lists were EMPTY. Measured rather than
   * predicted: the owner's 2026-10-17 `seed:demo` run produced 1298 rows with ZERO Branch and ZERO
   * Department rows.
   *
   * ## WHY THIS SIGNS NOBODY IN
   *
   * Authenticating inside a registered organization writes append-only `AuditLogEntry` rows into that
   * tenant, whose FK is `ON DELETE RESTRICT` behind a trigger that refuses DELETE outright — so one
   * login makes the organization PERMANENT and this cumulative suite would gain an office per run.
   * Two were stranded proving exactly that in item (d). The provisioning therefore goes through the
   * SERVICE inside `orgContext.runAs`, which `last-administrator-lock.e2e-spec.ts` establishes as the
   * same code path a request takes once `JwtStrategy` has settled the office.
   *
   * ## THE ASSERTIONS ARE EXACT, NOT TOLERANT
   *
   * `toHaveLength(1)` rather than `toBeGreaterThan(0)`: the defect was EMPTINESS, and a tolerant
   * assertion cannot see a bootstrap that half ran or one that ran twice. And the provisioning uses
   * the ids THOSE LISTS RETURNED, not ids this test created — a branch created by the test would
   * prove the DTO accepts one and say nothing about whether a real office has anything to offer.
   */
  let officeId: string;

  beforeAll(async () => {
    const res = await register(validOffice());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    officeId = (res.body as RegistrationBody).id;
  }, 300_000);

  it('has EXACTLY one default branch and one default department, created by registration', async () => {
    const [branches, departments] = await Promise.all([
      rawPrisma.branch.findMany({
        where: { organizationId: officeId },
        select: { name: true, nameAr: true },
      }),
      rawPrisma.department.findMany({
        where: { organizationId: officeId },
        select: { name: true, nameAr: true },
      }),
    ]);
    expect(branches).toHaveLength(1);
    expect(departments).toHaveLength(1);
    /*
     * Against the exported constants rather than against literals, so the names have one home. And
     * the ARABIC is asserted because this is an Arabic-first product: a default with no `nameAr`
     * renders blank in the language the office actually uses, which is the same half-delivered shape
     * as a description that reaches no screen.
     */
    expect(branches[0].name).toBe(DEFAULT_BRANCH.name);
    expect(branches[0].nameAr).toBe(DEFAULT_BRANCH.nameAr);
    expect(departments[0].name).toBe(DEFAULT_DEPARTMENT.name);
    expect(departments[0].nameAr).toBe(DEFAULT_DEPARTMENT.nameAr);
  }, 300_000);

  it('provisions a user with NO manual setup, in the PROVIDER organization', async () => {
    /*
     * THE PROVISIONING HALF RUNS IN THE PROVIDER, NOT IN THE OFFICE REGISTERED ABOVE, and the reason
     * is this file's own guard rather than a preference.
     *
     * `provision` writes an `AuditLogEntry` into the acting organization. That table's
     * `organizationId` FK is `ON DELETE RESTRICT` behind a trigger that refuses DELETE outright, so
     * ONE audit row makes an organization permanently undeletable — and this file asserts, by name,
     * that a registered office carries ZERO audit rows precisely so a later spec does not meet a
     * `createTestApp` failure that looks like its own fault. The first version of this test
     * provisioned into the registered office and that guard caught it, correctly; the office had to
     * be unstranded by hand.
     *
     * The PROVIDER is the right place for three reasons, not one: it is created by the SEED's
     * bootstrap, which is the other half of item 1 half B; it is permanent by design, so an audit row
     * there costs nothing and provider users already accumulate across runs by existing practice
     * (`createProviderUser` does the same); and it is the exact organization whose deadlock the owner
     * reported — she could not create a user as the provider.
     *
     * WHAT THIS SPLIT DOES NOT PROVE, stated rather than implied: that a REGISTERED office can
     * provision a user end to end in one act. Proving that in one organization would require either a
     * permanent fixture office or disabling an append-only guarantee, and both are the owner's
     * decision rather than mine. What the test above proves is that registration creates the two
     * rows; what this proves is that an organization holding those rows can provision with them.
     */
    const orgContext = app.get(OrgContextService);
    const users = app.get(UserAdminService);
    const providerId = operator.organizationId;

    const [branch, department, role] = await Promise.all([
      rawPrisma.branch.findFirstOrThrow({
        where: { organizationId: providerId },
        select: { id: true, name: true },
      }),
      rawPrisma.department.findFirstOrThrow({
        where: { organizationId: providerId },
        select: { id: true, name: true },
      }),
      rawPrisma.role.findFirstOrThrow({
        where: { organizationId: providerId },
        select: { id: true },
      }),
    ]);
    // The ids come from the BOOTSTRAP's rows, not from rows this test created — using its own would
    // prove the DTO accepts two ids and say nothing about whether a real organization has any.
    expect(branch.name).toBe(DEFAULT_BRANCH.name);
    expect(department.name).toBe(DEFAULT_DEPARTMENT.name);

    const email = `boot-first-user-${Date.now()}@ibms.test`;
    await orgContext.runAs(providerId, () =>
      users.provision(
        {
          email,
          // REQUIRED for an account with no person record behind it, and the service says why: it is
          // what every audit row of this account will be read by.
          fullName: 'Provider First User',
          password: 'FirstUser#2026!aA',
          departmentId: department.id,
          branchId: branch.id,
          roleIds: [role.id],
        },
        operator.userId,
      ),
    );

    const row = await rawPrisma.user.findFirstOrThrow({
      where: { organizationId: providerId, email },
      select: { branchId: true, departmentId: true },
    });
    // The two ids actually LANDED. A provisioning that stored nulls would satisfy a "did it return"
    // assertion, and being recorded is the whole purpose of the two fields.
    expect(row.branchId).toBe(branch.id);
    expect(row.departmentId).toBe(department.id);
  }, 300_000);
});
