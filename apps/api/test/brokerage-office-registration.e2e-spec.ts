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
import { rawPrisma } from './tenant-prisma';
import { OFFICE_ADMINISTRATOR_GRANTS } from '../src/modules/provider/office-administrator-grants';

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
  const users = await rawPrisma.user.count({ where: { organizationId } });
  expect(
    users,
    `a user exists inside registered office ${organizationId}. Signing in writes append-only audit rows, so that office can never be deleted and every later spec in this run will refuse. Nothing in this file may create a user inside an office it registered — use DEFAULT_OFFICE_ID`,
  ).toBe(0);

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
  await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
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
