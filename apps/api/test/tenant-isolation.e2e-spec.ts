import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { type RoleName } from '@ibms/db';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Part II §4.2.2 — provisioning now requires a Department, as a field distinct
 * from Role, plus the Branch §4.2.2 requires beside it. Created on demand,
 * through the admin endpoints rather than a raw insert, for this office.
 */
let provisioningOrgUnits: {
  departmentId: string;
  branchId: string;
} | null = null;
async function orgUnitsForProvisioning(
  app: INestApplication<App>,
  adminAccessToken: string,
): Promise<{ departmentId: string; branchId: string }> {
  if (provisioningOrgUnits) return provisioningOrgUnits;
  const suffix = Math.random().toString(36).slice(2, 8);
  const department = await request(app.getHttpServer())
    .post('/admin/departments')
    .set(bearer(adminAccessToken))
    .send({ name: `Spec Department ${suffix}` })
    .expect(201);
  const branch = await request(app.getHttpServer())
    .post('/admin/branches')
    .set(bearer(adminAccessToken))
    .send({ name: `Spec Branch ${suffix}` })
    .expect(201);
  provisioningOrgUnits = {
    departmentId: (department.body as { id: string }).id,
    branchId: (branch.body as { id: string }).id,
  };
  return provisioningOrgUnits;
}

/**
 * Multi-tenancy Phase 2 step 9 — the Part V "Multi-tenancy" checklist, run as
 * real tests across TWO Organizations.
 *
 * Spec step 9: "this is the point where a missed table would show up as a real
 * cross-tenant data leak, so it needs to be caught here, before Phase 3 adds
 * more surface area on top."
 *
 * Everything here uses a SECOND Organization created for the run, so these are
 * genuine cross-tenant assertions rather than single-office smoke tests. The
 * second org and everything in it is removed afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHY SOME OF THIS TALKS TO POSTGRES DIRECTLY
 * ---------------------------------------------------------------------------
 * Several checklist items are ABOUT the database layer — that RLS blocks what
 * the application layer would have let through. Asserting those through the API
 * would only prove the application layer works, which is the other layer. So
 * they connect as `ibms_app` (the role the API uses) and as the owner, and
 * compare what each can see.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';

/** The second office. Fixed id so a crashed run leaves something identifiable
 * rather than an anonymous orphan. */
const ORG_B_ID = '00000000-0000-0000-0000-0000000000b2';
const ORG_B_SUBDOMAIN = 'tenant-isolation-e2e-b';

/** Both offices get a customer with the SAME legal name — the checklist's own
 * framing, and the case where a leak would be least obvious. */
const SHARED_CUSTOMER_NAME = 'شركة الأمانة للتجارة العامة';

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function secretFromOtpAuthUri(uri: string): string {
  const match = /[?&]secret=([^&]+)/.exec(uri);
  if (!match) throw new Error('No secret in otpauth URI');
  return decodeURIComponent(match[1]);
}

let app: INestApplication<App> | null = null;

/** The app role's own connection — the one RLS actually applies to. */
const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

/**
 * Runs raw SQL as the APPLICATION role, optionally with `app.current_org_id`
 * set — i.e. exactly what the API's connection can see, with and without the
 * session variable the policies read.
 */
async function asAppRole<T>(
  organizationId: string | null,
  sql: string,
): Promise<T[]> {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    return await client.$transaction(async (tx) => {
      if (organizationId !== null) {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_org_id', '${organizationId}', true)`,
        );
      }
      return await tx.$queryRawUnsafe(sql);
    });
  } finally {
    await client.$disconnect();
  }
}

/** Raw SQL as the OWNER — used to inspect Postgres catalogs, which carry no
 * Prisma model and therefore no generated type. */
async function ownerQuery<T>(sql: string): Promise<T[]> {
  return await rawPrisma.$queryRawUnsafe(sql);
}

async function makeUserInDefaultOrg(
  application: INestApplication<App>,
  label: string,
  roles: RoleName[],
): Promise<{ accessToken: string; id: string }> {
  const email = uniqueEmail(label);
  await request(application.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `E2E ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(application.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as IssuedSessionBody;

  const enroll = await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as MfaEnrollBody;
  await request(application.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secretFromOtpAuthUri(enrollBody.otpAuthUri)),
    })
    .expect(200);

  for (const role of roles) {
    const roleRow = await prisma.role.upsert({
      where: { name: role },
      update: {},
      create: { name: role },
    });
    const existing = await prisma.userRoleAssignment.findFirst({
      where: { userId: body.user.id, roleId: roleRow.id, revokedAt: null },
    });
    if (!existing) {
      await prisma.userRoleAssignment.create({
        data: { userId: body.user.id, roleId: roleRow.id },
      });
    }
  }
  return { accessToken: body.accessToken, id: body.user.id };
}

let officeA: { accessToken: string; id: string };
let isolationAdmin: { accessToken: string; id: string };
let customerAId: string;
let customerBId: string;

/**
 * Removes office B and everything in it.
 *
 * Runs at the START of the suite as well as the end. `AuthService.signup`
 * refuses to run while more than one Organization exists — the deliberate
 * step-7 guard, since anonymous signup cannot tell which office an account
 * belongs to until Phase 4 resolves it from the subdomain. So a crashed run
 * that left office B behind would break `makeUser` in EVERY later spec file,
 * not just this one. Self-healing on entry makes that impossible.
 */
async function removeOfficeB(): Promise<void> {
  // Order matters: children before the rows they point at, and the
  // Organization last. A leftover child row's foreign key would otherwise pin
  // office B in place and defeat the self-heal entirely.
  await rawPrisma.organizationEmailIntegration.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.commissionAgreement.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.insurer.deleteMany({ where: { organizationId: ORG_B_ID } });
  // `InsurerMaster.legalName` is globally unique, so a master left behind by a
  // crashed run would collide with the next run's fixture rather than simply
  // taking up space. Masters are global and shared, so only the ones this
  // suite names are removed — never a sweep of the table.
  await rawPrisma.insurerMaster.deleteMany({
    where: { legalName: { startsWith: 'Cross-Office Mapped Insurer ' } },
  });
  await rawPrisma.insurerMaster.deleteMany({
    where: { legalName: 'Shared Insurer plc' },
  });
  await rawPrisma.ultimateBeneficialOwner.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.customer.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  // `AuditLogEntry` carries a Part 10.3 immutability trigger that rejects
  // every DELETE, so the rows this suite writes into office B would otherwise
  // pin the Organization row forever via its foreign key. `SET LOCAL
  // session_replication_role = replica` suspends user triggers for this
  // transaction only, and reverts on COMMIT — the documented owner-role
  // bypass the trigger's own migration comment names. It needs the OWNER
  // connection: `ibms_app` is NOSUPERUSER and genuinely cannot do this, which
  // is the point.
  await rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRaw`DELETE FROM "AuditLogEntry" WHERE "organizationId" = ${ORG_B_ID}`;
  });
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.user.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.organization.deleteMany({ where: { id: ORG_B_ID } });
}

beforeAll(async () => {
  app = await createTestApp();

  // Clear any office B a crashed run left behind, BEFORE signing anyone up.
  await removeOfficeB();

  // EVERY account this suite needs is created while exactly one Organization
  // exists, because signup refuses to guess once there are two. Office B is
  // stood up afterwards, below.
  officeA = await makeUserInDefaultOrg(app, 'office-a', [
    'SALES_RELATIONSHIP_OFFICER',
    'BRANCH_DEPARTMENT_MANAGER',
  ]);
  isolationAdmin = await makeUserInDefaultOrg(app, 'isolation-admin', [
    'SYSTEM_SECURITY_ADMINISTRATOR',
  ]);

  // Office A's customer, created through the API so it goes through both layers.
  const createdA = await request(app.getHttpServer())
    .post('/customers')
    .set(bearer(officeA.accessToken))
    .send({
      customerType: 'CORPORATE',
      legalName: SHARED_CUSTOMER_NAME,
      registrationNumber: `A-${Date.now()}`,
      registeredAddress: 'عمّان، الأردن',
      natureOfBusiness: 'تجارة عامة',
      contactPhone: '+962-7-9000-0001',
      contactEmail: uniqueEmail('office-a-customer'),
      languagePreference: 'AR',
    })
    .expect(201);
  customerAId = (createdA.body as { id: string }).id;

  // --- Only NOW the second office. Written as the OWNER: standing up an
  // --- Organization is a platform act, not something a tenant-scoped request
  // --- can do.
  await rawPrisma.organization.create({
    data: {
      id: ORG_B_ID,
      legalName: 'Rawabi Insurance Brokerage (tenant-isolation e2e)',
      legalNameAr: 'شركة الروابي لوساطة التأمين',
      subdomain: ORG_B_SUBDOMAIN,
    },
  });

  // Office B's customer, with the SAME legal name, written as the owner —
  // there is no authenticated path into office B yet (subdomain resolution is
  // Phase 4), and the point is to have a real foreign row to probe for.
  const ownerB = await rawPrisma.user.create({
    data: {
      organizationId: ORG_B_ID,
      fullName: 'Rawabi Officer',
      email: uniqueEmail('office-b'),
      passwordHash: 'not-a-login-account',
    },
  });
  const customerB = await rawPrisma.customer.create({
    data: {
      organizationId: ORG_B_ID,
      customerType: 'CORPORATE',
      legalName: SHARED_CUSTOMER_NAME,
      registrationNumber: `B-${Date.now()}`,
      registeredAddress: 'إربد، الأردن',
      natureOfBusiness: 'تجارة عامة',
      languagePreference: 'AR',
      // No contact details: they live in `contactPhoneEnc`/`contactEmailEnc`
      // and are written through the service's encryption, never by hand.
      ownerUserId: ownerB.id,
    },
  });
  customerBId = customerB.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
  app = null;
  // Owner connection: RLS would otherwise stop the cleanup seeing the very
  // rows it needs to remove. Leaving office B behind would break signup for
  // every spec file that runs after this one.
  await removeOfficeB();
});

describe('Part V — two Organizations cannot reach each other (item 1)', () => {
  it('both offices hold a customer of the identical legal name', async () => {
    const both = await rawPrisma.customer.findMany({
      where: { legalName: SHARED_CUSTOMER_NAME },
      select: { id: true, organizationId: true },
    });
    const orgs = new Set(both.map((c) => c.organizationId));
    expect(orgs.has(TEST_ORGANIZATION_ID)).toBe(true);
    expect(orgs.has(ORG_B_ID)).toBe(true);
  });

  it("a direct GET on the other office's real customer id is 404, NOT 403", async () => {
    // The checklist is explicit about this distinction: a 403 would confirm the
    // id exists, which is itself the leak. The row must be indistinguishable
    // from one that was never there.
    const res = await request(app!.getHttpServer())
      .get(`/customers/${customerBId}`)
      .set(bearer(officeA.accessToken));

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("the other office's customer never appears in a list, even searching its exact name", async () => {
    const list = await request(app!.getHttpServer())
      .get('/customers')
      .set(bearer(officeA.accessToken))
      .expect(200);
    const ids = (list.body as { id: string }[]).map((c) => c.id);

    expect(ids).toContain(customerAId);
    expect(ids).not.toContain(customerBId);
  });

  it("full-text search for the shared name returns only this office's row", async () => {
    // Search runs through $queryRaw, which the application layer cannot filter
    // — so this is RLS doing the work, not the middleware.
    const list = await request(app!.getHttpServer())
      .get(`/customers?search=${encodeURIComponent('الأمانة')}`)
      .set(bearer(officeA.accessToken))
      .expect(200);
    const ids = (list.body as { id: string }[]).map((c) => c.id);

    expect(ids).not.toContain(customerBId);
  });

  it("writing to the other office's customer is 404, not a silent success", async () => {
    const res = await request(app!.getHttpServer())
      .post(`/customers/${customerBId}/ubos`)
      .set(bearer(officeA.accessToken))
      .send({
        givenName: 'مقتحم',
        familyName: 'من مكتب آخر',
        nationalId: '9901019999',
        ownershipPercent: 10,
        isPep: false,
      });

    expect([404, 403]).toContain(res.status);
    expect(res.status).toBe(404);

    const ubos = await rawPrisma.ultimateBeneficialOwner.findMany({
      where: { customerId: customerBId },
    });
    expect(ubos).toHaveLength(0);
  });
});

describe('Part V — RLS blocks independently of the app layer (item 2)', () => {
  it('an UNFILTERED query on the app role returns only the org its session names', async () => {
    // This is the checklist's "disable the app-layer org filter" case: raw SQL
    // with no WHERE at all, exactly what a middleware bug would produce. RLS is
    // the only thing standing between it and every office's rows.
    const rows = await asAppRole<{ organizationId: string }>(
      TEST_ORGANIZATION_ID,
      `SELECT "organizationId" FROM "Customer"`,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.organizationId))).toEqual(
      new Set([TEST_ORGANIZATION_ID]),
    );
  });

  it("the same unfiltered query, pointed at office B, returns only office B's rows", async () => {
    const rows = await asAppRole<{ id: string }>(
      ORG_B_ID,
      `SELECT id FROM "Customer"`,
    );
    expect(rows.map((r) => r.id)).toEqual([customerBId]);
  });

  it('the OWNER connection does see both — which is why the API must not use it', async () => {
    // Not a leak: this is the migration/seed role, and Postgres exempts a
    // table's owner from its own policies. It is here because it is the exact
    // reason `APP_DATABASE_URL` exists.
    const all = await rawPrisma.customer.findMany({
      where: { legalName: SHARED_CUSTOMER_NAME },
      select: { organizationId: true },
    });
    expect(new Set(all.map((c) => c.organizationId)).size).toBeGreaterThan(1);
  });
});

describe('Part V — raw SQL is protected by RLS alone (item 3)', () => {
  it('returns ZERO rows with no app.current_org_id set — fail closed, never another org', async () => {
    const rows = await asAppRole<{ id: string }>(
      null,
      `SELECT id FROM "Customer"`,
    );
    expect(rows).toHaveLength(0);
  });

  it('the same is true for every tenant-scoped table a raw path touches', async () => {
    for (const table of ['Policy', 'Claim', 'Invoice', 'AuditLogEntry']) {
      const rows = await asAppRole<{ n: bigint }>(
        null,
        `SELECT count(*)::int AS n FROM "${table}"`,
      );
      expect(Number((rows[0] as unknown as { n: number }).n)).toBe(0);
    }
  });
});

describe('Part V — the runtime role cannot sidestep the policies (item 4)', () => {
  it('has no SUPERUSER, no BYPASSRLS, and owns no tables', async () => {
    const role = await ownerQuery<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ibms_app'`,
    );

    expect(role).toHaveLength(1);
    expect(role[0].rolsuper).toBe(false);
    expect(role[0].rolbypassrls).toBe(false);

    const owned = await ownerQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = 'ibms_app'`,
    );
    expect(Number(owned[0].n)).toBe(0);
  });

  it('every tenant-scoped table has RLS enabled and a policy on it', async () => {
    const rows = await ownerQuery<{ table: string }>(
      `SELECT c.relname AS table
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
             WHERE col.table_schema = 'public'
               AND col.table_name = c.relname
               AND col.column_name = 'organizationId')
          AND (c.relrowsecurity = false
               OR NOT EXISTS (SELECT 1 FROM pg_policies p
                               WHERE p.schemaname = 'public'
                                 AND p.tablename = c.relname))`,
    );

    // Spec §8: "a missed table is a real isolation hole."
    expect(rows.map((r) => r.table)).toEqual([]);
  });
});

describe('Part V — cross-org writes (item 5)', () => {
  it("INSERT into another org is rejected by WITH CHECK, even naming that org's id", async () => {
    await expect(
      asAppRole(
        TEST_ORGANIZATION_ID,
        `INSERT INTO "Customer" ("id","organizationId","customerType","legalName","ownerUserId","updatedAt")
         VALUES ('cross-org-probe','${ORG_B_ID}','CORPORATE','Smuggled','x',NOW())`,
      ),
    ).rejects.toThrow();

    const planted = await rawPrisma.customer.findUnique({
      where: { id: 'cross-org-probe' },
    });
    expect(planted).toBeNull();
  });

  it("UPDATE of another org's row BY PRIMARY KEY affects zero rows", async () => {
    await asAppRole(
      TEST_ORGANIZATION_ID,
      `UPDATE "Customer" SET "legalName" = 'hijacked' WHERE id = '${customerBId}'`,
    );

    const untouched = await rawPrisma.customer.findUnique({
      where: { id: customerBId },
      select: { legalName: true },
    });
    expect(untouched?.legalName).toBe(SHARED_CUSTOMER_NAME);
  });

  it("DELETE of another org's row BY PRIMARY KEY affects zero rows", async () => {
    await asAppRole(
      TEST_ORGANIZATION_ID,
      `DELETE FROM "Customer" WHERE id = '${customerBId}'`,
    );

    const survivor = await rawPrisma.customer.findUnique({
      where: { id: customerBId },
    });
    expect(survivor).not.toBeNull();
  });
});

describe('Part V — a write that reports success actually wrote (item 6)', () => {
  it('deactivating an account really blocks its login', async () => {
    // The regression this item exists for: RLS zero-filtered the write, the
    // service read "0 rows changed" as "already in that state", and returned
    // success while the account stayed active. Asserting the API response is
    // not enough — the post-condition is what matters.
    // Provisioned in `beforeAll`, while office A was still the only office:
    // signup refuses to guess an Organization once a second one exists. The
    // user BELOW is created through POST /admin/users, which is the path that
    // keeps working, because it names the Organization from the caller.
    const admin = isolationAdmin;
    const email = uniqueEmail('to-disable');

    const created = await request(app!.getHttpServer())
      .post('/admin/users')
      .set(bearer(admin.accessToken))
      .send({
        fullName: 'To Be Disabled',
        email,
        password: PASSWORD,
        ...(await orgUnitsForProvisioning(app!, admin.accessToken)),
        roles: ['SALES_RELATIONSHIP_OFFICER'],
      })
      .expect(201);
    const userId = (created.body as { id: string }).id;

    await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/admin/users/${userId}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(201);

    // The success response is worth nothing on its own — this is the assertion
    // that would have caught the step 8 bug.
    await request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);

    const row = await rawPrisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true },
    });
    expect(row?.isActive).toBe(false);
  }, 60_000);
});

describe('Part V — audit entries are scoped to their own Organization (item 12)', () => {
  it("office A's activity never writes an audit row against office B", async () => {
    await request(app!.getHttpServer())
      .get(`/customers/${customerAId}`)
      .set(bearer(officeA.accessToken))
      .expect(200);

    const strays = await rawPrisma.auditLogEntry.count({
      where: { organizationId: ORG_B_ID, userId: officeA.id },
    });
    expect(strays).toBe(0);
  });

  it("office A cannot read office B's audit trail — not even its existence", async () => {
    await rawPrisma.auditLogEntry.create({
      data: {
        organizationId: ORG_B_ID,
        userId: (
          await rawPrisma.user.findFirstOrThrow({
            where: { organizationId: ORG_B_ID },
          })
        ).id,
        action: 'READ',
        entityType: 'Customer',
        entityId: customerBId,
        isSensitiveDataAccess: false,
      },
    });

    // Spec §3.2: an office must never see even the EXISTENCE of another
    // office's audit trail — that alone leaks (e.g. "Office X had an incident
    // on this date").
    const visible = await asAppRole<{ n: number }>(
      TEST_ORGANIZATION_ID,
      `SELECT count(*)::int AS n FROM "AuditLogEntry" WHERE "entityId" = '${customerBId}'`,
    );
    expect(Number(visible[0].n)).toBe(0);
  });
});

describe('Part V — each office sends from its OWN mailbox (item 10, in part)', () => {
  it("office A cannot see office B's mailbox, and neither address is shared", async () => {
    // What this DOES prove: the sender is per-office, one office's mailbox
    // credential is invisible to another through both layers, and there is no
    // shared platform address anywhere in the model.
    //
    // What it does NOT prove, and the checklist item therefore stays open: that
    // a delivered message actually shows the office's address in a recipient's
    // inbox. That needs a real Microsoft 365 or Google Workspace mailbox and a
    // live OAuth consent, neither of which exists on this project yet.
    await rawPrisma.organizationEmailIntegration.deleteMany({
      where: {
        organizationId: { in: [TEST_ORGANIZATION_ID, ORG_B_ID] },
      },
    });

    const officeAMailbox = await rawPrisma.organizationEmailIntegration.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        provider: 'MICROSOFT365',
        connectedEmail: 'info@office-a.test',
        oauthRefreshTokenEnc: 'key-1:aXY=:dGFn:Y2lwaGVyLWE=',
        providerTenantId: 'tenant-a',
      },
    });
    const officeBMailbox = await rawPrisma.organizationEmailIntegration.create({
      data: {
        organizationId: ORG_B_ID,
        provider: 'GOOGLE_WORKSPACE',
        connectedEmail: 'info@office-b.test',
        oauthRefreshTokenEnc: 'key-1:aXY=:dGFn:Y2lwaGVyLWI=',
      },
    });

    // Two different real addresses — neither is a platform address.
    expect(officeAMailbox.connectedEmail).not.toBe(
      officeBMailbox.connectedEmail,
    );

    // Layer 2, directly: office A's session sees ONLY its own mailbox row.
    const visibleToA = await asAppRole<{ connectedEmail: string }>(
      TEST_ORGANIZATION_ID,
      `SELECT "connectedEmail" FROM "OrganizationEmailIntegration"`,
    );
    expect(visibleToA.map((r) => r.connectedEmail)).toEqual([
      'info@office-a.test',
    ]);

    const visibleToB = await asAppRole<{ connectedEmail: string }>(
      ORG_B_ID,
      `SELECT "connectedEmail" FROM "OrganizationEmailIntegration"`,
    );
    expect(visibleToB.map((r) => r.connectedEmail)).toEqual([
      'info@office-b.test',
    ]);

    // And with no Organization in the session it fails closed, like every other
    // tenant table — this one holds a mailbox credential, so that matters more
    // here than almost anywhere else.
    const unscoped = await asAppRole<{ n: number }>(
      null,
      `SELECT count(*)::int AS n FROM "OrganizationEmailIntegration"`,
    );
    expect(Number(unscoped[0].n)).toBe(0);

    // The API never hands the credential back, to anyone.
    const status = await request(app!.getHttpServer())
      .get('/admin/email-integration')
      .set(bearer(isolationAdmin.accessToken))
      .expect(200);
    const serialised = JSON.stringify(status.body);
    expect(serialised).toContain('info@office-a.test');
    expect(serialised).not.toContain('info@office-b.test');
    expect(serialised).not.toContain('Y2lwaGVy');

    await rawPrisma.organizationEmailIntegration.deleteMany({
      where: {
        organizationId: { in: [TEST_ORGANIZATION_ID, ORG_B_ID] },
      },
    });
  }, 60_000);
});

describe('Part V — an insurer form mapped once serves every office (item 8)', () => {
  it("office B reads office A's mapping unmodified, without re-mapping it", async () => {
    // §5's actual promise: the company's IDENTITY and its mapped submission
    // form are GLOBAL, so the second office to deal with an insurer inherits
    // the first office's work. This is the one Part V item where the correct
    // answer is that a row IS visible across offices — every other item here
    // asserts the opposite, which is exactly why it is worth pinning: a
    // well-meaning `organizationId` added to `InsurerFormTemplate` would pass
    // every other test in this file and silently break this promise.
    const master = await rawPrisma.insurerMaster.create({
      data: {
        legalName: `Cross-Office Mapped Insurer ${Date.now()}`,
        legalNameAr: 'شركة تأمين مشتركة',
        linesOffered: ['MOTOR'],
      },
    });

    // Each office holds its OWN relationship row against that one master.
    await rawPrisma.insurer.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        insurerMasterId: master.id,
      },
    });
    await rawPrisma.insurer.create({
      data: { organizationId: ORG_B_ID, insurerMasterId: master.id },
    });

    // Office A maps the form, through the real API.
    const mapped = await request(app!.getHttpServer())
      .post(`/insurer-masters/${master.id}/form-templates`)
      .set(bearer(isolationAdmin.accessToken))
      .send({
        insuranceLine: 'MOTOR',
        sourceDocumentRef: 'shared-motor-form.pdf',
        fields: [
          {
            fieldKey: 'insured_full_name',
            labelEn: 'Insured full name',
            labelAr: 'اسم المؤمن له',
            dataType: 'TEXT',
            isRequired: true,
            displayOrder: 0,
          },
        ],
      })
      .expect(201);
    const templateId = (mapped.body as { id: string }).id;

    // Read it back on the APP role inside OFFICE B's session — the connection
    // the API uses, with `app.current_org_id` set to the other office. If the
    // template were tenant-scoped in either layer, this returns nothing.
    const visible = await asAppRole<{
      id: string;
      insuranceLine: string;
      version: number;
      sourceDocumentRef: string | null;
    }>(
      ORG_B_ID,
      `SELECT id, "insuranceLine", version, "sourceDocumentRef"
         FROM "InsurerFormTemplate" WHERE id = '${templateId}'`,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].insuranceLine).toBe('MOTOR');
    expect(visible[0].version).toBe(1);
    expect(visible[0].sourceDocumentRef).toBe('shared-motor-form.pdf');

    // Unmodified means the FIELDS too — a template with no fields is not a
    // usable form, so visibility of the parent row alone would prove nothing.
    const fields = await asAppRole<{
      fieldKey: string;
      labelAr: string | null;
    }>(
      ORG_B_ID,
      `SELECT "fieldKey", "labelAr" FROM "InsurerFormField"
        WHERE "templateId" = '${templateId}' ORDER BY "displayOrder"`,
    );
    expect(fields.map((f) => f.fieldKey)).toEqual(['insured_full_name']);
    expect(fields[0].labelAr).toBe('اسم المؤمن له');

    // And both offices genuinely point at the SAME company, rather than having
    // each minted a rival copy of it.
    const sharing = await ownerQuery<{ n: number }>(
      `SELECT count(DISTINCT "organizationId")::int AS n
         FROM "Insurer" WHERE "insurerMasterId" = '${master.id}'`,
    );
    expect(Number(sharing[0].n)).toBe(2);

    await rawPrisma.insurerFormField.deleteMany({ where: { templateId } });
    await rawPrisma.insurerFormTemplate.deleteMany({
      where: { id: templateId },
    });
    await rawPrisma.insurer.deleteMany({
      where: { insurerMasterId: master.id },
    });
    await rawPrisma.insurerMaster.deleteMany({ where: { id: master.id } });
  }, 60_000);
});

describe("Part V — two offices' commercial terms with the same insurer (item 9)", () => {
  it("office B's commission agreement is invisible to office A", async () => {
    // Both offices deal with the SAME real company, which after the Part I §5
    // split means they share one global `InsurerMaster` row. That is the point:
    // the identity is shared, the negotiated terms below are not.
    const sharedMaster = await rawPrisma.insurerMaster.upsert({
      where: { legalName: 'Shared Insurer plc' },
      update: {},
      create: { legalName: 'Shared Insurer plc', linesOffered: ['MOTOR'] },
    });
    const insurerB = await rawPrisma.insurer.create({
      data: { organizationId: ORG_B_ID, insurerMasterId: sharedMaster.id },
    });
    const agreementB = await rawPrisma.commissionAgreement.create({
      data: {
        organizationId: ORG_B_ID,
        insurerId: insurerB.id,
        insuranceLine: 'MOTOR',
        ratePercent: '22.50',
        vatRatePercent: '16.00',
        effectiveFrom: new Date(),
      },
    });

    const visible = await asAppRole<{ n: number }>(
      TEST_ORGANIZATION_ID,
      `SELECT count(*)::int AS n FROM "CommissionAgreement" WHERE id = '${agreementB.id}'`,
    );
    expect(Number(visible[0].n)).toBe(0);
    // No cleanup here on purpose: `removeOfficeB` owns it, and runs whether or
    // not this test passes.
  });
});

/**
 * Part V multi-tenancy item 7 — Phase 6.
 *
 * Scheduled to Phase 4 when this suite was written, and testable now that
 * Phase 4 built `TenantMatchGuard`. The guard is the second opinion on which
 * office a request belongs to: the session says one thing, the address it
 * arrived on says another, and a disagreement is a hard 403.
 *
 * Both halves matter. A guard that refuses everything would pass the first
 * assertion and make the system unreachable, so the same token on its OWN
 * office's subdomain has to keep working.
 */
describe('Part V — a session is refused on another office’s subdomain (item 7)', () => {
  it("office A's token is rejected on office B's subdomain, and accepted on its own", async () => {
    // Mismatch: a real, registered subdomain belonging to a DIFFERENT office
    // than the one the session was issued for.
    const mismatched = await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(officeA.accessToken))
      .set('Host', `${ORG_B_SUBDOMAIN}.ibms-app.example`)
      .expect(403);
    expect((mismatched.body as { code?: string }).code).toBe('TENANT_MISMATCH');

    // The same token, same request, on its own office's subdomain.
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(officeA.accessToken))
      .set('Host', 'default.ibms-app.example')
      .expect(200);
  });

  it('a host naming no office is skipped rather than refused', async () => {
    // Every local, CI and e2e request looks like this. Refusing them would
    // make the system unreachable outside production DNS while proving
    // nothing: with no subdomain there is no second opinion to disagree with.
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(officeA.accessToken))
      .set('Host', 'localhost:4000')
      .expect(200);
  });

  it('an unknown but well-formed subdomain is skipped, not refused', async () => {
    // Refusing would turn the guard into a way to probe which office labels
    // are registered, which §4.10.4 rules out. A 200 here is the deliberate
    // answer, not an oversight.
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(officeA.accessToken))
      .set('Host', 'no-such-office-at-all.ibms-app.example')
      .expect(200);
  });

  it('records the mismatch as a security event against the session’s own office', async () => {
    await request(app!.getHttpServer())
      .get('/auth/me')
      .set(bearer(officeA.accessToken))
      .set('Host', `${ORG_B_SUBDOMAIN}.ibms-app.example`)
      .expect(403);

    const rows = await ownerQuery<{
      organizationId: string;
      afterValue: { reason?: string; requestedOrganizationId?: string } | null;
    }>(
      `SELECT "organizationId", "afterValue" FROM "AuditLogEntry"
       WHERE "userId" = '${officeA.id}' AND "action" = 'LOGIN_FAILED'
       ORDER BY "occurredAt" DESC LIMIT 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].afterValue?.reason).toBe('TENANT_MISMATCH');
    // Written against the office whose user actually did this — the one that
    // can act on it — naming the office the token was carried TO.
    expect(rows[0].organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(rows[0].afterValue?.requestedOrganizationId).toBe(ORG_B_ID);
  });
});

/**
 * Part V multi-tenancy item 11 — Phase 6.
 *
 * Scheduled to Phase 5 when this suite was written, and testable now that
 * Phase 5 built the importer. The item asks specifically about a file
 * carrying a "spoofed/incorrect org identifier", so that is what is uploaded.
 */
describe('Part V — a bulk import cannot write into another office (item 11)', () => {
  it('ignores an organizationId column naming office B and writes into office A', async () => {
    const spoofed = `Spoofed Import ${Date.now()}`;
    const csv = [
      'Client Name,Kind,organizationId,organisation_id,org',
      `${spoofed},CORPORATE,${ORG_B_ID},${ORG_B_ID},${ORG_B_ID}`,
    ].join('\n');

    await request(app!.getHttpServer())
      .post('/imports/customers')
      .set(bearer(isolationAdmin.accessToken))
      .field(
        'mapping',
        JSON.stringify({ legalName: 'Client Name', customerType: 'Kind' }),
      )
      .attach('file', Buffer.from(csv, 'utf8'), 'spoofed.csv')
      .expect(201);

    // Read as the OWNER, which sees every office — so this asserts where the
    // row actually landed, not merely where the caller can see it.
    const rows = await ownerQuery<{ organizationId: string }>(
      `SELECT "organizationId" FROM "Customer" WHERE "legalName" = '${spoofed}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(TEST_ORGANIZATION_ID);

    // Nothing at all reached office B.
    const inB = await ownerQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM "Customer" WHERE "organizationId" = '${ORG_B_ID}' AND "legalName" = '${spoofed}'`,
    );
    expect(inB[0].n).toBe('0');
  });

  it('refuses a mapping that tries to name organizationId as an importable field', async () => {
    // The stronger statement: there is no way to ASK for it either. The field
    // allow-list has no organizationId, so a mapping naming one is refused
    // outright rather than quietly ignored.
    await request(app!.getHttpServer())
      .post('/imports/customers')
      .set(bearer(isolationAdmin.accessToken))
      .field(
        'mapping',
        JSON.stringify({
          legalName: 'Client Name',
          customerType: 'Kind',
          organizationId: 'organizationId',
        }),
      )
      .attach(
        'file',
        Buffer.from('Client Name,Kind,organizationId\nX,CORPORATE,y', 'utf8'),
        'spoofed2.csv',
      )
      .expect(422);
  });
});
