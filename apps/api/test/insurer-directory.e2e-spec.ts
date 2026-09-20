import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authenticator } from 'otplib';
import { ensureRole, prisma, rawPrisma } from './tenant-prisma';
import { createTestApp } from './utils/test-app';
import { INSURER_DIRECTORY_COLUMNS } from '../src/repositories/insurer-directory.repository';
import { canonicalNameKey } from '../src/common/company-name.util';

/**
 * The cross-office insurer directory, and the boundary it must never cross.
 *
 * These are competing brokerages on one platform. The company is public knowledge; the
 * panel is not. So this file's job is less "does the list work" than "can anything about
 * another office leak through it", and the tests are ordered accordingly:
 *
 *  1. **The view's COLUMNS are exactly the allow-list.** The guard that outlives everyone
 *     here: the app role can read this view, so a column added to it next year is
 *     readable by anything that can run a query, whatever the service chooses to map. A
 *     new column has to fail a test rather than quietly appear.
 *  2. **The app role cannot read another office's `Insurer` row at all**, while the same
 *     role reads the whole directory. That asymmetry IS the mechanism — a SECURITY
 *     DEFINER view over an RLS-protected table — and it is measured here rather than
 *     assumed from the migration.
 *  3. **Nothing office-scoped appears in a response**, checked against planted values: a
 *     credit term, a financial-strength rating, a named relationship contact and the
 *     other office's id, none of which may appear anywhere in the serialised body.
 *  4. Aggregation as decided: one entry per company grouped by normalised name, lines
 *     unioned across offices, first non-null contact.
 *  5. Presence depends on having been REGISTERED, never on whether anyone currently deals
 *     with them.
 */

const PASSWORD = 'Correct-Horse-Battery-Staple-9';
const tag = Math.random().toString(36).slice(2, 8);

/**
 * A second Organization, because a cross-office directory cannot be tested from one
 * office. Fixed id and swept at BOTH ends, for the reason this suite has now learned
 * three times: a leaked Organization makes `signup` fail in every later spec file, and a
 * teardown that misses one RESTRICT child leaves the whole office behind.
 */
const ORG_B_ID = '00000000-0000-0000-0000-0000000005d1';
const FIXTURE_PREFIX = 'Directory Fixture';
/** The company both offices register, under two spellings that canonicalise to one key. */
const SHARED_EN = `${FIXTURE_PREFIX} Al Yarmouk Insurance`;
const SHARED_EN_B = `${FIXTURE_PREFIX}   al-yarmouk   insurance`;
const SHARED_AR = `${FIXTURE_PREFIX} شركة اليرموك للتأمين`;

const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

/** Runs SQL as `ibms_app` — the role the API itself uses — optionally with an office
 *  context. Without one, RLS leaves every tenant-scoped table empty, which is exactly the
 *  condition that makes the view's behaviour meaningful. */
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
      return await tx.$queryRawUnsafe<T[]>(sql);
    });
  } finally {
    await client.$disconnect();
  }
}

async function removeFixtures(): Promise<void> {
  // Children before parents, every foreign key here being RESTRICT. Office B's rows are
  // removed by organization; this office's by name prefix.
  await rawPrisma.insurerOfferedLine.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { insurer: { legalName: { startsWith: FIXTURE_PREFIX } } },
      ],
    },
  });
  await rawPrisma.insurer.deleteMany({
    where: {
      OR: [
        { organizationId: ORG_B_ID },
        { legalName: { startsWith: FIXTURE_PREFIX } },
      ],
    },
  });
  await rawPrisma.officeInsuranceLine.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.userRoleAssignment.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.rolePermission.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.role.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.user.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.organization.deleteMany({ where: { id: ORG_B_ID } });
}

interface DirectoryEntry {
  directoryKey: string;
  name: string | null;
  nameAr: string | null;
  structure: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyCorrespondenceAddress: string | null;
  lines: { code: string | null; nameEn: string; nameAr: string }[];
}

interface DirectoryPage {
  items: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

let app: INestApplication<App> | null = null;
/** Office A, holding the directory permission. */
let officeA: { accessToken: string; userId: string };
/** Holds `insurer.read` but NOT `insurer.directory.read` — Compliance, deliberately. */
let noDirectory: { accessToken: string };

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUser(
  label: string,
  roleName: string,
): Promise<{ accessToken: string; userId: string }> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@ibms.test`;
  await request(app!.getHttpServer())
    .post('/auth/signup')
    .send({ fullName: `Directory ${label}`, email, password: PASSWORD })
    .expect(201);
  const login = await request(app!.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const body = login.body as { accessToken: string; user: { id: string } };

  const enroll = await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll')
    .set(bearer(body.accessToken))
    .expect(201);
  const enrollBody = enroll.body as {
    credentialId: string;
    otpAuthUri: string;
  };
  const secret = /[?&]secret=([^&]+)/.exec(enrollBody.otpAuthUri)![1];
  await request(app!.getHttpServer())
    .post('/auth/mfa/totp/enroll/verify')
    .set(bearer(body.accessToken))
    .send({
      credentialId: enrollBody.credentialId,
      code: authenticator.generate(secret),
    })
    .expect(200);

  const role = await ensureRole(roleName);
  await prisma.userRoleAssignment.create({
    data: { userId: body.user.id, roleId: role.id },
  });
  return { accessToken: body.accessToken, userId: body.user.id };
}

/** The canonical key the application would compute — the real function, statically
 *  imported. The view groups by what the app STORED, so a second normaliser written here
 *  would be testing something other than the thing that runs. */
function canonicalOf(name: string): string {
  return canonicalNameKey(name);
}

function searchDirectory(term: string, token = officeA.accessToken) {
  return request(app!.getHttpServer())
    .get(`/insurer-directory?search=${encodeURIComponent(term)}`)
    .set(bearer(token));
}

beforeAll(async () => {
  await removeFixtures();
  app = await createTestApp();
  officeA = await makeUser(`dir-a-${tag}`, 'SALES_RELATIONSHIP_OFFICER');
  noDirectory = await makeUser(`dir-none-${tag}`, 'COMPLIANCE_OFFICER');

  // Office A registers the company, with office-scoped values that must never surface.
  const aCanonical = canonicalOf(SHARED_EN);
  const motor = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'MOTOR_COMPREHENSIVE' },
  });
  const travel = await rawPrisma.insuranceLine.findFirstOrThrow({
    where: { code: 'TRAVEL' },
  });
  const insurerA = await prisma.insurer.create({
    data: {
      legalName: SHARED_EN,
      legalNameAr: SHARED_AR,
      canonicalName: aCanonical,
      structure: 'TAKAFUL',
      companyPhone: '+962 6 500 7000',
      companyEmail: 'contact@yarmouk.test',
      // Office-scoped, all of it. Planted so a leak has something recognisable to find.
      creditTermsDays: 45,
      financialStrengthRating: 'A-(office-A-only)',
      rfqContactName: 'Office A Private Contact',
      claimsContactEmail: 'office-a-claims@yarmouk.test',
    },
  });
  await prisma.insurerOfferedLine.create({
    data: { insurerId: insurerA.id, insuranceLineId: motor.id },
  });

  // --- Office B, stood up as the OWNER. Registering the SAME company under a different
  // --- spelling that canonicalises to the same key, with its own contact gaps and its own
  // --- extra line, so the aggregation rules have something to resolve.
  await rawPrisma.organization.create({
    data: {
      id: ORG_B_ID,
      legalName: 'Directory Office B',
      legalNameAr: 'مكتب الدليل ب',
      subdomain: `directory-office-b-${tag}`,
    },
  });
  const insurerB = await rawPrisma.insurer.create({
    data: {
      organizationId: ORG_B_ID,
      legalName: SHARED_EN_B,
      legalNameAr: SHARED_AR,
      // The same key from a different spelling — extra spaces, a hyphen, lower case.
      canonicalName: canonicalOf(SHARED_EN_B),
      structure: 'TAKAFUL',
      // No phone: office A's fills the gap. A website office A lacks: B's fills that one.
      companyEmail: 'b-side@yarmouk.test',
      companyWebsite: 'yarmouk.test',
      creditTermsDays: 90,
      financialStrengthRating: 'BBB(office-B-only)',
      rfqContactName: 'Office B Private Contact',
    },
  });
  await rawPrisma.insurerOfferedLine.create({
    data: {
      organizationId: ORG_B_ID,
      insurerId: insurerB.id,
      insuranceLineId: travel.id,
    },
  });
}, 600_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('the view exposes exactly the allow-list', () => {
  it('has these columns and no others', async () => {
    // THE guard. The app role can read this view, so any column on it is readable by
    // anything that can run a query — the service's mapping is a second line of defence,
    // not the boundary. Enumerated from `information_schema` rather than from a list in
    // this file, so it describes the database and not somebody's intention.
    const columns = await rawPrisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'InsurerDirectory'
        ORDER BY column_name`,
    );
    expect(
      columns.map((c) => c.column_name).sort(),
      'a column added to the directory view is readable by every office — add it to INSURER_DIRECTORY_COLUMNS only if it is genuinely public company data',
    ).toEqual([...INSURER_DIRECTORY_COLUMNS].sort());
  }, 120_000);

  it('is not writable, so the directory cannot be edited into a channel', async () => {
    // An aggregating view is not auto-updatable in Postgres. Asserted because the default
    // privileges in this database grant INSERT/UPDATE/DELETE on new relations, so "the
    // grant says SELECT only" is not by itself the whole reason.
    await expect(
      asAppRole(null, `DELETE FROM "InsurerDirectory"`),
    ).rejects.toThrow(/cannot delete from view|not automatically updatable/i);
  }, 120_000);

  it('returns entries to the app role that cannot see the underlying rows', async () => {
    // The mechanism, measured. With no office context RLS leaves `Insurer` empty for this
    // role — and the same role, in the same transaction, reads the whole directory.
    const rows = await asAppRole<{ n: bigint }>(
      null,
      `SELECT count(*)::bigint AS n FROM "Insurer"`,
    );
    expect(Number(rows[0].n)).toBe(0);
    const entries = await asAppRole<{ n: bigint }>(
      null,
      `SELECT count(*)::bigint AS n FROM "InsurerDirectory"`,
    );
    expect(Number(entries[0].n)).toBeGreaterThan(0);
  }, 120_000);
});

describe('nothing office-scoped reaches a caller', () => {
  it('never returns a credit term, a rating, a relationship contact or an office id', async () => {
    const response = await searchDirectory(SHARED_EN).expect(200);
    const body = JSON.stringify(response.body);

    // DISTINCTIVE planted values, each from a column that must not cross, searched in the
    // WHOLE serialised body so a leak through an unexpected key is caught too.
    //
    // Deliberately NOT the numeric ones: `creditTermsDays` is 45 and 90, and "45" turns up
    // in phone numbers and page totals — scanning for it would fail for reasons that are
    // not leaks, and a test that cries wolf gets deleted. Numbers are covered by the
    // field-name check below, which is precise where a substring scan cannot be.
    for (const planted of [
      'A-(office-A-only)',
      'BBB(office-B-only)',
      'Office A Private Contact',
      'Office B Private Contact',
      'office-a-claims@yarmouk.test',
      ORG_B_ID,
    ]) {
      expect(
        body,
        `${planted} must not appear in a directory response`,
      ).not.toContain(planted);
    }

    // And no office-scoped FIELD, by name — what catches a numeric or boolean leak that a
    // value scan cannot tell from a coincidence.
    for (const field of [
      'creditTermsDays',
      'financialStrengthRating',
      'rfqContact',
      'claimsContact',
      'underwriterContact',
      'isActive',
      'organizationId',
      'insurerMasterId',
    ]) {
      expect(
        body,
        `${field} must not be a key in a directory response`,
      ).not.toContain(field);
    }
  }, 300_000);

  it('gives every entry exactly the allow-listed keys', async () => {
    const response = await searchDirectory(SHARED_EN).expect(200);
    const page = response.body as DirectoryPage;
    expect(page.items.length).toBeGreaterThan(0);
    for (const entry of page.items) {
      expect(Object.keys(entry).sort()).toEqual(
        [...INSURER_DIRECTORY_COLUMNS].sort(),
      );
    }
  }, 300_000);

  it('is gated on its own permission, which insurer.read does not imply', async () => {
    // Compliance holds `insurer.read` — its own office's panel — and deliberately not the
    // directory: the two answer opposite questions, and one code for both would mean an
    // office could not be given the market without also being given its own panel.
    await searchDirectory(SHARED_EN, noDirectory.accessToken).expect(403);
  }, 300_000);
});

describe('one entry per company', () => {
  it('merges two offices under one normalised name, unions their lines, fills contact gaps', async () => {
    const response = await searchDirectory(SHARED_EN).expect(200);
    const page = response.body as DirectoryPage;
    const entries = page.items.filter((e) => e.name?.includes('Yarmouk'));

    // ONE entry, though two offices registered it under different spellings.
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.directoryKey).toBe(canonicalOf(SHARED_EN));

    // First non-null, earliest registration first — so office A's name and phone win,
    // and office B fills the website office A never supplied.
    expect(entry.name).toBe(SHARED_EN);
    expect(entry.companyPhone).toBe('+962 6 500 7000');
    expect(entry.companyEmail).toBe('contact@yarmouk.test');
    expect(entry.companyWebsite).toBe('yarmouk.test');
    expect(entry.structure).toBe('TAKAFUL');

    // The UNION of what both offices say the company writes, with no hint of which said
    // what.
    expect(entry.lines.map((l) => l.code).sort()).toEqual([
      'MOTOR_COMPREHENSIVE',
      'TRAVEL',
    ]);
  }, 300_000);

  it('finds a company by its ARABIC name too', async () => {
    const response = await searchDirectory('شركة اليرموك').expect(200);
    const page = response.body as DirectoryPage;
    expect(page.items.map((e) => e.nameAr)).toContain(SHARED_AR);
  }, 300_000);

  it('returns the standard page envelope', async () => {
    const response = await request(app!.getHttpServer())
      .get('/insurer-directory?pageSize=5')
      .set(bearer(officeA.accessToken))
      .expect(200);
    const page = response.body as DirectoryPage;
    expect(page.items).toHaveLength(5);
    expect(page).toMatchObject({ page: 0, pageSize: 5 });
    // `count(*)` is a bigint in Postgres; a total that reached the wire as one would
    // throw on serialisation rather than arriving as a number.
    expect(typeof page.total).toBe('number');
    expect(page.total).toBeGreaterThan(5);
  }, 300_000);
});

describe('presence depends on registration, not on anyone still dealing with them', () => {
  it('keeps a company whose ONLY office has deactivated it', async () => {
    // The rule, and the reasoning: a company vanishing once the last office stopped
    // dealing with it would be a weakened form of exactly the disclosure the boundary
    // forbids — the disappearance itself is a signal about other offices' behaviour.
    const name = `${FIXTURE_PREFIX} Retired Everywhere ${tag}`;
    const insurer = await prisma.insurer.create({
      data: {
        legalName: name,
        legalNameAr: `${FIXTURE_PREFIX} متروك تماما ${tag}`,
        canonicalName: canonicalOf(name),
        structure: 'CONVENTIONAL',
        companyPhone: '+962 6 500 8000',
        companyEmail: 'still-listed@example.test',
        isActive: false,
      },
    });
    expect(insurer.isActive).toBe(false);

    const response = await searchDirectory('Retired Everywhere').expect(200);
    const page = response.body as DirectoryPage;
    expect(page.items.map((e) => e.name)).toContain(name);
    // And the entry says nothing about the deactivation — `isActive` is an office-scoped
    // fact and is not in the allow-list at all.
    expect(JSON.stringify(page.items)).not.toContain('isActive');
  }, 300_000);

  it('lists a company with no lines recorded rather than hiding it', async () => {
    // An office often registers a company before it knows the product list. A directory
    // that dropped those would be least useful for exactly the newest entries.
    const name = `${FIXTURE_PREFIX} No Lines Yet ${tag}`;
    await prisma.insurer.create({
      data: {
        legalName: name,
        legalNameAr: `${FIXTURE_PREFIX} بلا خطوط ${tag}`,
        canonicalName: canonicalOf(name),
        structure: 'CONVENTIONAL',
        companyPhone: '+962 6 500 9000',
        companyEmail: 'no-lines@example.test',
      },
    });

    const response = await searchDirectory('No Lines Yet').expect(200);
    const entry = (response.body as DirectoryPage).items.find(
      (e) => e.name === name,
    );
    expect(entry).toBeDefined();
    expect(entry!.lines).toEqual([]);
  }, 300_000);
});
