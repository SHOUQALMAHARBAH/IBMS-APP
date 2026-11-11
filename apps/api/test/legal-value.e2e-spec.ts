import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * MODULE 1 — THE LEGAL-VALUES TABLE, OWNER DECISION 123's criteria, against a real database.
 *
 * Each test names the criterion of decision 123's «معيار الجودة» it proves. Criterion 3 is also
 * proved at the derivation level in `legal-figures.config.spec.ts`; what is proved HERE is the half
 * a unit test cannot reach — which row the database SELECTS for a date, and what it REFUSES.
 *
 * ## 🔴 WHY THE RLS ASSERTIONS OPEN THEIR OWN CONNECTION, which is the sharpest thing in this file
 *
 * MEASURED 2026-11-11, and it matters beyond this spec: **the e2e suite's own client connects as
 * `ibms`, and on db-test `ibms` is a SUPERUSER with BYPASSRLS** (`rolsuper=t, rolbypassrls=t`),
 * while on the dev database the same role name is neither (`f, f`). A superuser bypasses row-level
 * security entirely — even `FORCE ROW LEVEL SECURITY` — so **an RLS refusal asserted through
 * `prisma` or `rawPrisma` here would be asserting nothing at all**, and would pass with every
 * policy dropped.
 *
 * So criterion 7's RLS half runs through `asAppRole`, on `APP_DATABASE_URL` — the same non-owner
 * connection the API itself uses (`prisma.service.ts` reads that variable and logs an error if it
 * is unset, because the fallback makes layer 2 inert). CI sets it at `ci.yml:331` and provisions
 * the role at `:405`. The helper is the shape `tenant-isolation.e2e-spec.ts` established.
 */
const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const RUN = Math.random().toString(36).slice(2, 8);

/** A code nobody else uses, so every assertion is about the rows THIS run created. db-test is
 *  cumulative and a leftover row must not be able to make an assertion pass or fail. */
const CODE = `ZZ_TEST_DEFERRED_VALUE_${RUN.toUpperCase()}`;
const DORMANT_CODE = `ZZ_TEST_DORMANT_${RUN.toUpperCase()}`;

/** The app role's own connection — the one RLS actually applies to. */
const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

let app: INestApplication<App> | null = null;
const createdRoleIds: string[] = [];

interface IssuedSessionBody {
  accessToken: string;
  user: { id: string };
}
interface MfaEnrollBody {
  credentialId: string;
  otpAuthUri: string;
}
interface LegalValueBody {
  id: string;
  code: string;
  kind: string;
  numericValue: string | null;
  dateValue: string | null;
  sourceType: string;
  sourceInstrument: string | null;
  sourceArticle: string | null;
  sourcePrintedPage: number | null;
  sourceReference: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  organizationId: string | null;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Raw SQL as the APPLICATION role, with `app.current_org_id` set to `organizationId` (or left
 * unset when null) — exactly what the API's connection can see.
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

/** Like `asAppRole`, but for a statement with no result set — returns the affected row count. */
async function execAsAppRole(
  organizationId: string | null,
  sql: string,
): Promise<number> {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    return await client.$transaction(async (tx) => {
      if (organizationId !== null) {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.current_org_id', '${organizationId}', true)`,
        );
      }
      return await tx.$executeRawUnsafe(sql);
    });
  } finally {
    await client.$disconnect();
  }
}

/** A signed-in user holding a role with EXACTLY these codes — an empty list is a real case. */
async function actorHolding(
  label: string,
  codes: string[],
): Promise<{ accessToken: string; userId: string }> {
  const server = (app as INestApplication<App>).getHttpServer();
  const org = await prisma.organization.findFirstOrThrow({
    orderBy: { id: 'asc' },
  });
  const permissions = await prisma.permission.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  });
  // A mistyped code grants nothing and would make every refusal below pass for the wrong reason.
  expect(permissions.map((p) => p.code).sort()).toEqual([...codes].sort());

  const role = await prisma.role.create({
    data: {
      organizationId: org.id,
      name: `${label.toUpperCase()}_${RUN}`,
      nameEn: label,
      nameAr: label,
      requiresMfaAlways: false,
      requiresHardwareToken: false,
      permissions: {
        create: permissions.map((p) => ({
          organizationId: org.id,
          permissionId: p.id,
        })),
      },
    },
    select: { id: true },
  });
  createdRoleIds.push(role.id);

  const email = `${label}-${RUN}@legalvalue.test`;
  await request(server)
    .post('/auth/signup')
    .send({ fullName: `LV ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const { accessToken, user } = login.body as IssuedSessionBody;

  const enroll = await request(server)
    .post('/auth/mfa/totp/enroll')
    .set(bearer(accessToken))
    .expect(201);
  const eb = enroll.body as MfaEnrollBody;
  await request(server)
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(accessToken))
    .send({
      credentialId: eb.credentialId,
      code: authenticator.generate(
        /[?&]secret=([^&]+)/.exec(eb.otpAuthUri)![1],
      ),
    })
    .expect(200);

  await prisma.userRoleAssignment.create({
    data: { userId: user.id, roleId: role.id },
  });
  return { accessToken, userId: user.id };
}

let declarer: { accessToken: string; userId: string };
let readerOnly: { accessToken: string; userId: string };

beforeAll(async () => {
  app = await createTestApp();
  declarer = await actorHolding('lv-declarer', [
    'legal-value.declare',
    'legal-value.read',
  ]);
  readerOnly = await actorHolding('lv-reader', ['legal-value.read']);
}, 120_000);

afterAll(async () => {
  // The rows this run created, by its own unique codes. Never a blanket delete: db-test is shared
  // and a `deleteMany({})` here would remove the 13 seeded instrument figures that every licence
  // assertion in the suite depends on.
  await rawPrisma.legalValue.deleteMany({
    where: { code: { in: [CODE, DORMANT_CODE] } },
  });
  for (const id of createdRoleIds) {
    await rawPrisma.rolePermission.deleteMany({ where: { roleId: id } });
  }
  await app?.close();
});

describe('the instrument own figures are readable by an office', () => {
  it('returns art. 4/a five figures, each with its article and the page it was read on', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const res = await request(server)
      .get('/legal-values')
      .set(bearer(readerOnly.accessToken))
      .expect(200);
    const rows = res.body as LegalValueBody[];

    // PROVIDER rows are NULL-org and the tenant extension's declared read-widening is what lets
    // an office see them. Without `PROVIDER_OWNED_NULL_ORG_MODELS` this list would be empty.
    const provider = rows.filter((r) => r.organizationId === null);
    expect(provider.length).toBeGreaterThanOrEqual(13);

    const band2 = provider.find((r) => r.code === 'CAPITAL_MIN_JOD_BAND_2');
    expect(band2).toBeDefined();
    // SEVEN THOUSAND FIVE HUNDRED. The OCR extraction publishes 7,000 here and marks it trusted.
    expect(band2!.numericValue).toBe('7500');
    expect(band2!.sourceArticle).toBe('art. 4/a/2');
    expect(band2!.sourcePrintedPage).toBe(5);
    expect(band2!.sourceType).toBe('INSTRUMENT');

    const firstBoundary = provider.find(
      (r) => r.code === 'CAPITAL_MAX_BRANCHES_BAND_1',
    );
    // SIX. The extraction publishes 5.
    expect(firstBoundary!.numericValue).toBe('6');

    // Every provider row carries its citation — the CHECK guarantees it, and this is the
    // observation that the guarantee is live rather than merely written.
    for (const row of provider) {
      expect(row.sourceInstrument, row.code).toBeTruthy();
      expect(row.sourceArticle, row.code).toBeTruthy();
      expect(typeof row.sourcePrintedPage, row.code).toBe('number');
    }
  });
});

describe('CRITERION 1 — remove the permission and the declaration is refused', () => {
  it('REFUSES a holder of legal-value.read alone', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    await request(server)
      .post('/legal-values')
      .set(bearer(readerOnly.accessToken))
      .send({
        code: CODE,
        name: 'A deferred value, for the test',
        kind: 'MONEY_JOD',
        numericValue: '1500',
        sourceReference: 'CBJ letter 1/2/3 of 2027',
        effectiveFrom: '2027-01-01',
      })
      .expect(403);
  });

  it('ACCEPTS a holder of legal-value.declare, and records WHO declared it', async () => {
    // The positive half, which a negative test cannot give: a 403 for everybody would also pass
    // the test above.
    const server = (app as INestApplication<App>).getHttpServer();
    const res = await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send({
        code: CODE,
        name: 'A deferred value, for the test',
        kind: 'MONEY_JOD',
        numericValue: '1500',
        sourceReference: 'CBJ letter 1/2/3 of 2027',
        effectiveFrom: '2027-01-01',
      })
      .expect(201);
    const row = res.body as LegalValueBody;
    expect(row.sourceType).toBe('OFFICE_DECLARATION');
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(row.numericValue).toBe('1500');

    const stored = await prisma.legalValue.findUniqueOrThrow({
      where: { id: row.id },
      select: { createdByUserId: true, sourceReference: true },
    });
    // ATTRIBUTABLE — decision 123's whole point. The system never says *this is the legal
    // ceiling*; it says *this is the ceiling your office declared, and here is who declared it*.
    expect(stored.createdByUserId).toBe(declarer.userId);
    expect(stored.sourceReference).toBe('CBJ letter 1/2/3 of 2027');
  });
});

describe('CRITERION 2 — remove the reference or the date and the row is refused', () => {
  const base = {
    code: `${CODE}_X`,
    name: 'Another deferred value',
    kind: 'MONEY_JOD' as const,
    numericValue: '10',
    sourceReference: 'CBJ letter 9/9/9',
    effectiveFrom: '2027-02-01',
  };

  /** `base` with one key removed — a function rather than a destructuring-to-omit, which leaves an
   *  unused binding that `no-unused-vars` refuses. */
  function without(key: keyof typeof base): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...base };
    delete copy[key];
    return copy;
  }

  it('REFUSES a declaration with no reference', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send(without('sourceReference'))
      .expect(400);
  });

  it('REFUSES a declaration with no effective date', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send(without('effectiveFrom'))
      .expect(400);
  });

  it('REFUSES a blank reference, not only a missing one', async () => {
    // `@Length(3, 300)` and a `btrim(...) <> ''` CHECK. A whitespace reference satisfies "a field
    // was filled in" and satisfies nothing a reader of the register needs.
    const server = (app as INestApplication<App>).getHttpServer();
    await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send({ ...base, sourceReference: '  ' })
      .expect(400);
  });
});

describe('CRITERION 3 — an old transaction computes at the value in force on ITS day', () => {
  it('a replacement is APPENDED and the superseded row keeps its own window', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    // The first row was declared in criterion 1's test, from 2027-01-01. Supersede it from
    // 2027-06-01 with a different figure.
    await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send({
        code: CODE,
        name: 'A deferred value, for the test',
        kind: 'MONEY_JOD',
        numericValue: '2500',
        sourceReference: 'CBJ letter 4/5/6 of 2027',
        effectiveFrom: '2027-06-01',
      })
      .expect(201);

    const history = await request(server)
      .get(`/legal-values/${CODE}/history`)
      .set(bearer(readerOnly.accessToken))
      .expect(200);
    const rows = history.body as LegalValueBody[];

    // TWO rows, not one edited row. "A change is appended, never overwritten" is the property
    // criterion 3 rests on, and it is observable only as a count plus a closed window.
    expect(rows).toHaveLength(2);
    const [newest, oldest] = rows;
    expect(newest.numericValue).toBe('2500');
    expect(newest.effectiveTo).toBeNull();
    expect(oldest.numericValue).toBe('1500');
    expect(oldest.effectiveTo).not.toBeNull();
    // The superseded row closes exactly where the replacement opens: no gap, no overlap. A gap is
    // a day with no legal value at all; an overlap is a day with two.
    expect(new Date(oldest.effectiveTo!).toISOString().slice(0, 10)).toBe(
      '2027-06-01',
    );
  });

  it('reading at a date inside the OLD window returns the OLD figure', async () => {
    // The half a unit test cannot reach: which row the DATABASE selects for a date. The repository
    // applies the effective dating so no caller can forget it.
    const inOldWindow = await asAppRole<{ numericValue: string }>(
      TEST_ORGANIZATION_ID,
      `SELECT "numericValue"::text AS "numericValue" FROM "LegalValue"
        WHERE "code" = '${CODE}' AND "organizationId" IS NOT NULL
          AND "effectiveFrom" <= DATE '2027-03-15'
          AND ("effectiveTo" IS NULL OR "effectiveTo" > DATE '2027-03-15')`,
    );
    expect(inOldWindow).toHaveLength(1);
    expect(Number(inOldWindow[0].numericValue)).toBe(1500);

    const inNewWindow = await asAppRole<{ numericValue: string }>(
      TEST_ORGANIZATION_ID,
      `SELECT "numericValue"::text AS "numericValue" FROM "LegalValue"
        WHERE "code" = '${CODE}' AND "organizationId" IS NOT NULL
          AND "effectiveFrom" <= DATE '2027-07-15'
          AND ("effectiveTo" IS NULL OR "effectiveTo" > DATE '2027-07-15')`,
    );
    expect(inNewWindow).toHaveLength(1);
    expect(Number(inNewWindow[0].numericValue)).toBe(2500);
  });

  it('exactly ONE row is open per code per office — the partial unique', async () => {
    // A raw insert of a second open row, as the app role, in its own transaction. The partial
    // unique is on `effectiveTo IS NULL`, so this is the one constraint that makes "the value in
    // force" a single answer at all.
    await expect(
      execAsAppRole(
        TEST_ORGANIZATION_ID,
        `INSERT INTO "LegalValue" ("id","organizationId","code","name","kind","numericValue","sourceType","sourceReference","effectiveFrom","updatedAt")
         VALUES (gen_random_uuid(), '${TEST_ORGANIZATION_ID}', '${CODE}', 'a rival open row', 'MONEY_JOD', 99, 'OFFICE_DECLARATION', 'ref', DATE '2027-09-01', now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('CRITERION 6 — an empty office value is DORMANT, and nothing rests on it', () => {
  it('a declared code with no figure is stored with a NULL value', async () => {
    const server = (app as INestApplication<App>).getHttpServer();
    const res = await request(server)
      .post('/legal-values')
      .set(bearer(declarer.accessToken))
      .send({
        code: DORMANT_CODE,
        name: 'A value the Central Bank has not issued',
        kind: 'TEXT_LIST',
        sourceReference: 'awaiting a CBJ decision',
        effectiveFrom: '2027-01-01',
      })
      .expect(201);
    const row = res.body as LegalValueBody;
    // NULL and not zero. A zero would be a figure; the absence of one is a different fact, and
    // the difference is the whole of criterion 6.
    expect(row.numericValue).toBeNull();
    expect(row.dateValue).toBeNull();
  });

  it('and the licence gate still answers — no refusal is built on the empty field', async () => {
    // The assertion that makes "dormant" mean something. A dormant row that quietly refused an act
    // would be the worst reading of an absent legal value: the office stopped by a figure nobody
    // has ever stated.
    const server = (app as INestApplication<App>).getHttpServer();
    await request(server)
      .get('/legal-values')
      .set(bearer(readerOnly.accessToken))
      .expect(200);
    const licence = await request(server)
      .get('/broker-license')
      .set(bearer(readerOnly.accessToken));
    // 403 (no licence permission) or 200 — either proves the request was SERVED rather than
    // refused by a legal value that does not exist. A 422 would be the dormant row biting.
    expect([200, 403]).toContain(licence.status);
  });
});

describe('CRITERION 7 — an office account cannot enter an instrument value', () => {
  it('🔴 the connection making these assertions is NOT exempt from RLS', async () => {
    // RULE 12, and the reason this spec opens its own client: the suite's own `prisma` connects as
    // `ibms`, which on db-test is a SUPERUSER with BYPASSRLS — so every refusal below would pass
    // with all three policies dropped. Asserted as PRESENCE of the right role, not absence of a
    // problem.
    const who = await asAppRole<{ u: string; s: boolean; b: boolean }>(
      null,
      'SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS s, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS b',
    );
    expect(who).toHaveLength(1);
    expect(
      who[0].s,
      `${who[0].u} is a SUPERUSER — RLS does not apply to it`,
    ).toBe(false);
    expect(who[0].b, `${who[0].u} has BYPASSRLS`).toBe(false);
  });

  it('REFUSES an office account inserting a PROVIDER row (organizationId NULL)', async () => {
    await expect(
      execAsAppRole(
        TEST_ORGANIZATION_ID,
        `INSERT INTO "LegalValue" ("id","organizationId","code","name","kind","numericValue","sourceType","sourceInstrument","sourceArticle","sourcePrintedPage","effectiveFrom","updatedAt")
         VALUES (gen_random_uuid(), NULL, 'ZZ_FORGED_${RUN}', 'forged', 'COUNT', 3, 'INSTRUMENT', 'CBJ Instructions No. 9 of 2026', 'art. 15/d', 17, DATE '2026-06-24', now())`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('CANNOT UPDATE a provider row — zero rows, not an error', async () => {
    // RLS filters rather than refuses on UPDATE, so the proof is the COUNT. A test asserting a
    // thrown error here would fail on a correct database and get "fixed" by weakening it.
    const affected = await execAsAppRole(
      TEST_ORGANIZATION_ID,
      `UPDATE "LegalValue" SET "numericValue" = 1 WHERE "code" = 'MIN_INSURERS_PER_REQUEST'`,
    );
    expect(affected).toBe(0);
    const unchanged = await asAppRole<{ v: string }>(
      TEST_ORGANIZATION_ID,
      `SELECT "numericValue"::text AS v FROM "LegalValue" WHERE "code" = 'MIN_INSURERS_PER_REQUEST'`,
    );
    expect(Number(unchanged[0].v)).toBe(3);
  });

  it('CANNOT DELETE a provider row', async () => {
    const affected = await execAsAppRole(
      TEST_ORGANIZATION_ID,
      `DELETE FROM "LegalValue" WHERE "code" = 'RENEWAL_APPLICATION_DUE_DAYS_BEFORE_EXPIRY'`,
    );
    expect(affected).toBe(0);
  });

  it('REFUSES an office row claiming the instrument own authority — the CHECK', async () => {
    /*
     * The second half of criterion 7, and it refuses a different thing from the policy: an office
     * row is ALLOWED to exist, and is not allowed to say `INSTRUMENT`.
     *
     * THE ROW IS OTHERWISE COMPLETE ON PURPOSE — it carries `sourceReference` and
     * `createdByUserId`, the two an office row must have. The first version of this test omitted
     * them and was refused by `LegalValue_office_row_cites_its_reference` instead, so it passed
     * for the wrong reason: a constraint fired, but not the one under test, and deleting the
     * ownership CHECK would have left this test green.
     */
    await expect(
      execAsAppRole(
        TEST_ORGANIZATION_ID,
        `INSERT INTO "LegalValue" ("id","organizationId","code","name","kind","numericValue","sourceType","sourceInstrument","sourceArticle","sourcePrintedPage","sourceReference","createdByUserId","effectiveFrom","updatedAt")
         VALUES (gen_random_uuid(), '${TEST_ORGANIZATION_ID}', 'ZZ_CLAIMED_${RUN}', 'claimed', 'COUNT', 3, 'INSTRUMENT', 'CBJ Instructions No. 9 of 2026', 'art. 15/d', 17, 'a real reference', '${declarer.userId}', DATE '2026-06-24', now())`,
      ),
    ).rejects.toThrow(/LegalValue_owner_matches_source_type/);
  });

  it('REFUSES a provider row with no citation — the other CHECK, as the OWNER', async () => {
    // Run as the owner, because only the owner can write a provider row at all. What is under test
    // is that even the seed cannot write a figure with no article and no page.
    await expect(
      rawPrisma.$executeRawUnsafe(
        `INSERT INTO "LegalValue" ("id","organizationId","code","name","kind","numericValue","sourceType","effectiveFrom","updatedAt")
         VALUES (gen_random_uuid(), NULL, 'ZZ_UNCITED_${RUN}', 'uncited', 'COUNT', 3, 'INSTRUMENT', DATE '2026-06-24', now())`,
      ),
    ).rejects.toThrow(/LegalValue_provider_row_cites_its_source/);
  });
});

describe('CRITERION 4 half — another office cannot read this office declared row', () => {
  it('sees the provider figures and NOT this office declaration', async () => {
    // A fabricated organization id rather than a second seeded office: the policy compares
    // `organizationId = current_setting(...)`, so any id that is not this one is the test. Nothing
    // is created, so nothing has to be torn down.
    const other = '00000000-0000-0000-0000-0000000000ff';
    const rows = await asAppRole<{ code: string }>(
      other,
      `SELECT "code" FROM "LegalValue" WHERE "code" IN ('${CODE}', 'MIN_INSURERS_PER_REQUEST')`,
    );
    const codes = rows.map((r) => r.code);
    // The instrument's own figure: visible, because every office must be able to compute.
    expect(codes).toContain('MIN_INSURERS_PER_REQUEST');
    // This office's declaration: invisible.
    expect(codes).not.toContain(CODE);
  });

  it('and with NO org set at all, only the provider rows are visible', async () => {
    // Fail-closed: `current_setting(..., true)` is NULL when unset and `col = NULL` is NULL, never
    // true — so a connection that forgets the variable sees the law and nobody's declarations.
    const rows = await asAppRole<{ code: string }>(
      null,
      `SELECT "code" FROM "LegalValue" WHERE "code" IN ('${CODE}', 'MIN_INSURERS_PER_REQUEST')`,
    );
    expect(rows.map((r) => r.code)).toEqual(['MIN_INSURERS_PER_REQUEST']);
  });
});
