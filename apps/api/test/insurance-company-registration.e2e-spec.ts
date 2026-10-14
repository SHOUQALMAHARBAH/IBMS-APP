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

/**
 * MODULE 0-ب ITEM (e) — REGISTERING AN INSURANCE COMPANY, over real HTTP.
 *
 * ## DECISION 90 IS THE SPINE OF THIS FILE
 *
 * Every constraint reachable from this screen is asserted to produce a SENTENCE, and every one of
 * those assertions also checks that the constraint name, the SQLSTATE and "violates ... constraint"
 * are ABSENT. A 4xx that could be any refusal tells a person nothing; the decision is that the
 * message names what to do.
 *
 * ## TEARDOWN, AND THE LESSON THAT MADE IT STRICTER
 *
 * db-test is cumulative and `createTestApp` asserts exactly ONE brokerage office. An insurance
 * company is not a brokerage office, so that particular assertion is not at risk here — but
 * `organization-type.e2e-spec.ts` and `role-security-attributes.e2e-spec.ts` both read the SET of
 * organizations, so a leak still reaches other specs. The file sweeps on ENTRY as well as on exit,
 * because an `afterAll` is exactly what cannot be relied on: one threw in the sibling spec and left
 * seven offices behind.
 *
 * NOTHING HERE MAY CREATE A USER inside a registered company. Signing in writes append-only audit
 * rows and the organization then cannot be deleted at all — measured the hard way in item (d).
 */

let app: INestApplication<App>;
let operator: { accessToken: string; userId: string; organizationId: string };
const createdIds: string[] = [];

let legalFormId: string;
let licensingAuthorityId: string;
let businessModelId: string;
let countryId: string;
let cityId: string;
let bankId: string;
let generalLineIds: string[];
let lifeLineId: string;

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let seq = 0;
const unique = (prefix: string) => `${prefix}${RUN}${seq++}`;

interface RegisteredCompany {
  id: string;
  code: string | null;
  legalName: string;
  shortName: string | null;
  certificateDocumentId: string;
  licensedLineCount: number;
  licensedCategories: string[];
}
interface ErrorBody {
  message: string | string[];
}

function validCompany(over: Record<string, unknown> = {}) {
  return {
    code: unique('INS'),
    legalNameAr: 'شركة تأمين للاختبار',
    legalName: 'Test Insurance Company',
    shortName: 'TestIns',
    legalFormId,
    nationalEstablishmentNo: unique('INAT'),
    commercialRegistrationNo: unique('ICR'),
    taxNumber: unique('ITAX'),
    insurerLicenseNumber: unique('CBJ-INS'),
    licensingAuthorityId,
    businessModelId,
    licensedLineIds: generalLineIds.slice(0, 2),
    certificateFileName: 'cbj-insurer-licence.pdf',
    certificateStorageRef: 'not-a-real-store/cbj-insurer-licence.pdf',
    countryId,
    cityId,
    address: 'Amman, Jordan',
    phone: '+962790000001',
    email: `company-${RUN}@example.test`,
    quotationEmail: `quotes-${RUN}@example.test`,
    claimsEmail: `claims-${RUN}@example.test`,
    integrationMethod: 'EMAIL',
    bankId,
    iban: 'JO94CBJO0010000000000131000302',
    subdomain: `ins-${RUN}-${seq++}`.toLowerCase(),
    ...over,
  };
}

/** Deletes one registered company and everything hanging off it, in FK order. Shared by the entry
 *  sweep and the teardown — the entry sweep is how this file heals itself. */
async function deleteCompany(organizationId: string) {
  const users = await rawPrisma.user.count({ where: { organizationId } });
  expect(
    users,
    `a user exists inside registered company ${organizationId}. Signing in writes append-only audit rows, so that organization can never be deleted and every later spec in this run will refuse`,
  ).toBe(0);

  await rawPrisma.insurerLicensedLine.deleteMany({
    where: { insuranceCompanyId: organizationId },
  });
  // The certificate is referenced BY the organization, so the pointer must be cleared before the
  // document can go — `onDelete: Restrict`, deliberately, because the document is the evidence.
  const org = await rawPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { insurerLicenseCertificateDocumentId: true },
  });
  await rawPrisma.organization.updateMany({
    where: { id: organizationId },
    data: { insurerLicenseCertificateDocumentId: null },
  });
  if (org?.insurerLicenseCertificateDocumentId) {
    await rawPrisma.document.deleteMany({
      where: { id: org.insurerLicenseCertificateDocumentId },
    });
  }
  await rawPrisma.organization.deleteMany({ where: { id: organizationId } });
}

beforeAll(async () => {
  const leftovers = await rawPrisma.organization.findMany({
    where: { type: 'INSURANCE_COMPANY', subdomain: { startsWith: 'ins-' } },
    select: { id: true },
  });
  for (const l of leftovers) await deleteCompany(l.id);

  app = await createTestApp();
  operator = await createProviderUser(app, 'provider-insurer-registration');

  const [forms, authority, model, country, city, bank, lines] =
    await Promise.all([
      rawPrisma.legalForm.findMany({ select: { id: true } }),
      rawPrisma.licensingAuthority.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.businessModel.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.country.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.city.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.bank.findFirstOrThrow({ select: { id: true } }),
      rawPrisma.insuranceLine.findMany({
        select: { id: true, category: true },
      }),
    ]);
  legalFormId = forms[0].id;
  licensingAuthorityId = authority.id;
  businessModelId = model.id;
  countryId = country.id;
  cityId = city.id;
  bankId = bank.id;
  generalLineIds = lines
    .filter((l) => l.category === 'GENERAL')
    .map((l) => l.id);
  lifeLineId = lines.filter((l) => l.category === 'LIFE')[0].id;

  expect(generalLineIds.length).toBeGreaterThan(1);
  expect(lifeLineId).toBeTruthy();
}, 300_000);

afterAll(async () => {
  for (const id of createdIds) await deleteCompany(id);
  await app?.close();
}, 300_000);

async function register(body: Record<string, unknown>) {
  const response = await request(app.getHttpServer())
    .post('/provider/insurance-companies')
    .set(...bearerHeader(operator.accessToken))
    .send(body);
  const registered = response.body as Partial<RegisteredCompany>;
  if (response.status === 201 && typeof registered.id === 'string') {
    createdIds.push(registered.id);
  }
  return response;
}

/** DECISION 90, applied to every refusal in this file: the message is a sentence, and the database
 *  never speaks. */
function expectNoConstraintLeak(body: unknown) {
  const serialised = JSON.stringify(body);
  expect(serialised).not.toMatch(/violates (check|unique) constraint/i);
  expect(serialised).not.toMatch(/\b2(3505|3514|3503)\b/);
  expect(serialised).not.toMatch(/Organization_[a-zA-Z_]+_key/);
}

describe('the provider registers an insurance company', () => {
  it('creates it with its licence certificate and its licensed lines', async () => {
    const response = await register(validCompany());
    expect(response.status).toBe(201);
    const view = response.body as RegisteredCompany;

    const organization = await rawPrisma.organization.findUniqueOrThrow({
      where: { id: view.id },
    });
    expect(organization.type).toBe('INSURANCE_COMPANY');
    // `Organization_broker_kind_matches_type` requires this to be NULL for a company, and the route
    // satisfies it by never setting it rather than by clearing it afterwards.
    expect(organization.brokerKind).toBeNull();
    /*
     * THE ONLY THING ENFORCING THIS COMPANY'S CERTIFICATE IS THE SERVICE, so this assertion is the
     * whole of the guarantee and is deliberately read from the STORED RECORD rather than from the
     * 201 the write returned — a mapper can report a field it did not persist (§ 1.80).
     *
     * The asymmetry with the brokerage side is PERMANENT and must not be "fixed":
     * `BrokerLicense.certificateDocumentId` is NOT NULL, while this column is nullable and the mirror
     * CHECK permits NULL — which is exactly what makes the three-statement transaction legal.
     * Tightening it to NOT NULL would reinstate the circular foreign key that made every registration
     * a 500.
     *
     * Proven by planting: removing the third statement kills this test alone.
     */
    expect(organization.insurerLicenseCertificateDocumentId).toBe(
      view.certificateDocumentId,
    );
    expect(organization.ibanEnc).toBeTruthy();
    expect(organization.ibanEnc).not.toContain('JO94CBJO');

    const document = await rawPrisma.document.findUniqueOrThrow({
      where: { id: view.certificateDocumentId },
    });
    // ITS OWN CATEGORY, never the broker's — the two licences are different instruments.
    expect(document.category).toBe('INSURER_LICENSE_CERTIFICATE');

    const lines = await rawPrisma.insurerLicensedLine.findMany({
      where: { insuranceCompanyId: view.id },
    });
    expect(lines).toHaveLength(2);
    // DERIVED from the catalogue categories, never stored.
    expect(view.licensedCategories).toEqual(['GENERAL']);
  }, 180_000);

  it('TOUCHES NO EXISTING ROW — the resolver is a split, not a move', async () => {
    /*
     * DECISION 63's delivery evidence, asserted over HTTP rather than only in the migration.
     * Registering a company must not reach any office's `Insurer` record: not to link it, not to
     * rewrite a company fact the office typed, not at all. An office links its own record when it
     * chooses to, through its own permission, and that act is logged.
     */
    const before = await rawPrisma.insurer.findMany({
      select: { id: true, insuranceCompanyId: true, companyPhone: true },
      orderBy: { id: 'asc' },
    });
    expect(before.length).toBeGreaterThan(0);

    expect((await register(validCompany())).status).toBe(201);

    const after = await rawPrisma.insurer.findMany({
      select: { id: true, insuranceCompanyId: true, companyPhone: true },
      orderBy: { id: 'asc' },
    });
    expect(
      after,
      'registering a company changed an office’s own insurer record — the split has become a move',
    ).toEqual(before);
  }, 180_000);
});

describe('decision 90 — every refusal is a sentence, never a constraint', () => {
  it('the duplicate establishment number, and the index is PLATFORM-WIDE', async () => {
    /*
     * THE FIXTURE I EXPECTED DID NOT EXIST, and the measurement is worth keeping: NO brokerage office
     * in db-test carries a `nationalEstablishmentNo`. Item (d) made every registration column
     * NULLABLE rather than backfilling facts nobody can source, so the pre-existing offices have
     * none — and the first version of this test asked for one and threw.
     *
     * So the cross-type property is proven the OTHER way round, which is also the stronger reading:
     * register a company through the route, then attempt a BROKERAGE OFFICE row carrying the same
     * number with raw Prisma, and assert the DATABASE refuses it. The sibling spec proves the
     * office→company direction the same way; between them the index is shown to be platform-wide
     * rather than per-type.
     */
    const company = validCompany();
    expect((await register(company)).status).toBe(201);

    // SAME TYPE, through the route: the readable 409.
    const second = await register(
      validCompany({
        nationalEstablishmentNo: company.nationalEstablishmentNo,
      }),
    );
    expect(second.status).toBe(409);
    const message = String((second.body as ErrorBody).message);
    expect(message).toContain(company.nationalEstablishmentNo);
    expect(message).toMatch(/already registered/i);
    // The SENTENCE carries the cross-type claim, which is what a person needs to know.
    expect(message).toMatch(/brokerage office or an insurance company/i);
    expectNoConstraintLeak(second.body);

    // ACROSS TYPES, at the database: a brokerage office cannot take the number either.
    let code: string | undefined;
    try {
      await rawPrisma.organization.create({
        data: {
          type: 'BROKERAGE_OFFICE',
          brokerKind: 'CORPORATE',
          legalName: 'Collision Brokerage Office',
          legalNameAr: 'مكتب وساطة متصادم',
          subdomain: `collide-office-${RUN}`,
          nationalEstablishmentNo: company.nationalEstablishmentNo,
        },
      });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(
      code,
      'a BROKERAGE OFFICE was accepted carrying an insurance company’s national establishment number — the unique index is not platform-wide',
    ).toBe('P2002');
  }, 180_000);

  it('the duplicate code, naming the shared namespace', async () => {
    const first = validCompany();
    expect((await register(first)).status).toBe(201);
    const response = await register(validCompany({ code: first.code }));
    expect(response.status).toBe(409);
    expect(String((response.body as ErrorBody).message)).toMatch(
      /one namespace/i,
    );
    expectNoConstraintLeak(response.body);
  }, 180_000);

  it('an API integration with no endpoint — the sheet’s conditional field', async () => {
    const response = await register(validCompany({ integrationMethod: 'API' }));
    expect(response.status).toBe(422);
    expect(String((response.body as ErrorBody).message)).toMatch(
      /needs its endpoint/i,
    );
    expectNoConstraintLeak(response.body);
  }, 180_000);

  it('and an endpoint with a NON-API integration — the other direction', async () => {
    /*
     * The half that would be easy to skip. Without it an implementation that only checked one way
     * would pass the test above while letting an endpoint be recorded against an EMAIL integration —
     * a value nothing reads, which item (b) established is a value somebody eventually reads.
     */
    const response = await register(
      validCompany({
        integrationMethod: 'EMAIL',
        apiEndpoint: 'https://example.test/api',
      }),
    );
    expect(response.status).toBe(422);
    expect(String((response.body as ErrorBody).message)).toMatch(
      /does not use one/i,
    );
    expectNoConstraintLeak(response.body);
  }, 180_000);

  it('saving without the licence certificate', async () => {
    const { certificateFileName, ...without } = validCompany();
    expect(certificateFileName).toBeTruthy();
    const response = await register(without);
    expect(response.status).toBe(400);
    expect(JSON.stringify((response.body as ErrorBody).message)).toContain(
      'certificateFileName',
    );
    expectNoConstraintLeak(response.body);
  }, 180_000);

  it('a line that is not in the standard catalogue', async () => {
    const response = await register(
      validCompany({
        licensedLineIds: ['00000000-0000-4000-8000-000000000001'],
      }),
    );
    expect(response.status).toBe(422);
    expect(String((response.body as ErrorBody).message)).toMatch(
      /standard catalogue/i,
    );
    expectNoConstraintLeak(response.body);
  }, 180_000);

  it('BOTH insurance types are accepted — a company is not a broker', async () => {
    /*
     * The non-empty positive case, and it says something specific: art. 3/a's one-type rule binds a
     * NATURAL-PERSON BROKER, not an insurance company. An implementation that reused the broker's
     * licensed-lines model would have inherited that refusal here — which is the structural reason
     * `InsurerLicensedLine` exists.
     */
    const response = await register(
      validCompany({ licensedLineIds: [generalLineIds[0], lifeLineId] }),
    );
    expect(response.status).toBe(201);
    expect((response.body as RegisteredCompany).licensedCategories).toEqual([
      'GENERAL',
      'LIFE',
    ]);
  }, 180_000);
});

describe('the boundary — who may register a company', () => {
  it('refuses an office user who HOLDS the permission, and says why', async () => {
    const office = await rawPrisma.organization.findFirstOrThrow({
      where: { type: 'BROKERAGE_OFFICE' },
      select: { id: true },
    });
    const permission = await rawPrisma.permission.findUniqueOrThrow({
      where: { code: 'provider.insurer.register' },
      select: { id: true, scope: true },
    });
    expect(permission.scope).toBe('PLATFORM');

    const role = await rawPrisma.role.create({
      data: {
        organizationId: office.id,
        name: `E2E_INSURER_REGISTER_${RUN}`,
        nameEn: 'E2E insurer register',
        nameAr: 'اختبار تسجيل شركة تأمين',
        requiresMfaAlways: true,
      },
      select: { id: true },
    });
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
      label: 'office-holding-insurer-register',
    });

    const response = await request(app.getHttpServer())
      .post('/provider/insurance-companies')
      .set(...bearerHeader(user.accessToken))
      .send(validCompany());

    expect(response.status).toBe(403);
    expect(String((response.body as ErrorBody).message)).toMatch(
      /platform operator/i,
    );

    // Deactivated rather than deleted: signing in wrote append-only audit rows, so the user is
    // permanent. The GRANT is what must not survive.
    await rawPrisma.userRoleAssignment.deleteMany({
      where: { userId: user.userId },
    });
    await rawPrisma.userSession.deleteMany({ where: { userId: user.userId } });
    await rawPrisma.mfaCredential.deleteMany({
      where: { userId: user.userId },
    });
    await rawPrisma.user.update({
      where: { id: user.userId },
      data: { isActive: false },
    });
    await rawPrisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await rawPrisma.role.deleteMany({ where: { id: role.id } });
  }, 300_000);
});
