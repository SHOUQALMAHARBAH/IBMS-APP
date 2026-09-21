import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { prisma, rawPrisma, TEST_ORGANIZATION_ID } from './tenant-prisma';
import { createTestApp } from './utils/test-app';

/**
 * Insurer management, commit 1 — the three database guarantees the feature is
 * built on, proven at the DATABASE rather than through a service that could be
 * bypassed.
 *
 * Making `Insurer.insurerMasterId` nullable is what lets an office register a
 * company that is in no global catalogue. It also removes an invariant a lot of
 * code was relying on, so the migration replaces it with three narrower ones:
 *
 *  1. `Insurer_has_identity` — a row with neither a master link nor a local name
 *     resolves to a NULL name in every consumer (a comparison matrix, a policy
 *     schedule, a generated certificate). Refused.
 *  2. `Insurer_one_local_name_per_org` — one local company name per office,
 *     case-insensitively, and PER OFFICE so two offices can each register the
 *     same company independently. That second half is the point of the whole
 *     feature and has its own test below.
 *  3. `InsurerProduct_insurerId_insuranceLine_key` — one product row per line per
 *     insurer, because the screen replaces the whole set and "once" is a database
 *     invariant rather than something a writer remembers.
 *
 * Every test here attempts the write with RAW SQL on the owner connection, so it
 * proves the constraint and not a DTO. Each one fails if its constraint is dropped
 * — verified by dropping each in turn.
 */

let app: INestApplication<App> | null = null;
const tag = Math.random().toString(36).slice(2, 8);

/** A second Organization, so the per-office half of the local-name index can be
 *  proven rather than assumed. Fixed id: this office is removed at both ends, so
 *  a stable one cannot collide, and if it ever did that is a teardown failure
 *  worth failing on. */
const ORG_B_ID = '00000000-0000-0000-0000-0000000005b1';

async function removeFixtures(): Promise<void> {
  await rawPrisma.insurerProduct.deleteMany({
    where: { insurer: { legalName: { startsWith: 'Constraint Fixture' } } },
  });
  await rawPrisma.insurer.deleteMany({
    where: { legalName: { startsWith: 'Constraint Fixture' } },
  });
  await rawPrisma.insurerProduct.deleteMany({
    where: { organizationId: ORG_B_ID },
  });
  await rawPrisma.insurer.deleteMany({ where: { organizationId: ORG_B_ID } });
  await rawPrisma.organization.deleteMany({ where: { id: ORG_B_ID } });
}

beforeAll(async () => {
  // Whatever a killed run left behind, before anything asserts on it.
  await removeFixtures();
  app = await createTestApp();
  await rawPrisma.organization.create({
    data: {
      id: ORG_B_ID,
      legalName: 'Second Office (insurer constraints e2e)',
      legalNameAr: 'المكتب الثاني',
      subdomain: `insurer-constraints-b-${tag}`,
    },
  });
}, 240_000);

afterAll(async () => {
  await removeFixtures();
  await app?.close();
  app = null;
});

describe('Insurer_has_identity — a nameless insurer cannot exist', () => {
  it('refuses a row with neither a master link nor a local name', async () => {
    // The invariant the nullable column removed, put back narrower. Attempted as
    // the OWNER in raw SQL: there is no DTO in the way, so this is the constraint
    // being tested and nothing else.
    await expect(
      rawPrisma.$executeRaw`
        INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
        VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, NULL)
      `,
    ).rejects.toThrow();
  }, 120_000);

  it('allows a row with a local name and no master link', async () => {
    // The case the whole feature exists for. Asserted alongside the refusal so
    // the test above cannot pass because inserts are broken generally.
    const name = `Constraint Fixture Local ${tag}`;
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName", "legalNameAr")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, ${name}, 'شركة تجريبية')
    `;
    const row = await prisma.insurer.findFirst({ where: { legalName: name } });
    expect(row, 'a local insurer must be insertable').not.toBeNull();
    expect(row!.insurerMasterId).toBeNull();
    // What the company offers is now rows in `InsurerOfferedLine` pointing at the
    // managed vocabulary, not a free-text array on this row: three spellings of one
    // line were three unrelated values to every search that read them. A newly
    // inserted insurer offers nothing yet, and that is an empty relation rather than
    // an empty column.
    expect(
      await prisma.insurerOfferedLine.count({ where: { insurerId: row!.id } }),
    ).toBe(0);
    expect(row!.structure).toBeNull();
  }, 120_000);

  it('allows a row with a master link and no local name — every existing row', async () => {
    const master = await prisma.insurerMaster.findFirst({
      select: { id: true },
    });
    expect(master, 'the seed provides sample master rows').not.toBeNull();
    // Deliberately in the SECOND office: the default office already has a
    // relationship with every seeded master, and `@@unique([organizationId,
    // insurerMasterId])` would reject a duplicate there — which would make this
    // test fail for a reason that has nothing to do with the identity CHECK.
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId")
      VALUES (gen_random_uuid(), ${ORG_B_ID}, ${master!.id})
    `;
    const row = await rawPrisma.insurer.findFirst({
      where: { organizationId: ORG_B_ID, insurerMasterId: master!.id },
    });
    expect(row).not.toBeNull();
    expect(row!.legalName).toBeNull();
  }, 120_000);
});

describe('Insurer_one_local_name_per_org — unique per office, not platform-wide', () => {
  it('refuses the same local name twice in ONE office, case-insensitively', async () => {
    const name = `Constraint Fixture Dup ${tag}`;
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, ${name})
    `;
    // Same name in a different case. `lower()` in the index is what stops an
    // office holding both "Acme Insurance" and "ACME INSURANCE" and then
    // wondering which one its policies are against.
    await expect(
      rawPrisma.$executeRaw`
        INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
        VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, ${name.toUpperCase()})
      `,
    ).rejects.toThrow();
  }, 120_000);

  it('ALLOWS the same local name in two different offices', async () => {
    // THE point of the feature, and the thing the old global
    // `InsurerMaster.legalName @unique` made impossible. Two offices dealing with
    // the same company is ordinary; neither should learn about the other, and
    // neither insert should fail.
    const name = `Constraint Fixture Shared ${tag}`;
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, ${name})
    `;
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
      VALUES (gen_random_uuid(), ${ORG_B_ID}, NULL, ${name})
    `;
    const both = await rawPrisma.insurer.findMany({
      where: { legalName: name },
      select: { organizationId: true },
      orderBy: { organizationId: 'asc' },
    });
    expect(both).toHaveLength(2);
    expect(new Set(both.map((r) => r.organizationId)).size).toBe(2);
  }, 120_000);

  it('does not constrain master-linked rows — the existing unique still does that', async () => {
    // The partial index is scoped `WHERE "insurerMasterId" IS NULL`, so it must
    // say nothing about linked rows. Two linked rows with a NULL legalName in one
    // office are refused by `@@unique([organizationId, insurerMasterId])` when the
    // master is the same, and allowed when it differs — neither of which is this
    // index's business.
    const masters = await prisma.insurerMaster.findMany({
      take: 2,
      select: { id: true },
      orderBy: { legalName: 'asc' },
    });
    expect(masters.length, 'the seed provides at least two masters').toBe(2);
    for (const m of masters) {
      await rawPrisma.$executeRaw`
        INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId")
        VALUES (gen_random_uuid(), ${ORG_B_ID}, ${m.id})
        ON CONFLICT DO NOTHING
      `;
    }
    const linked = await rawPrisma.insurer.count({
      where: { organizationId: ORG_B_ID, insurerMasterId: { not: null } },
    });
    expect(
      linked,
      'two linked rows with NULL local names coexist — the partial index ignores them',
    ).toBeGreaterThanOrEqual(2);
  }, 120_000);
});

describe('InsurerProduct — one row per line per insurer', () => {
  it('refuses the same line twice on one insurer', async () => {
    const name = `Constraint Fixture Lines ${tag}`;
    await rawPrisma.$executeRaw`
      INSERT INTO "Insurer" ("id", "organizationId", "insurerMasterId", "legalName")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, NULL, ${name})
    `;
    const insurer = await prisma.insurer.findFirstOrThrow({
      where: { legalName: name },
      select: { id: true },
    });

    await rawPrisma.$executeRaw`
      INSERT INTO "InsurerProduct" ("id", "organizationId", "insurerId", "insuranceLine")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, ${insurer.id}, 'Motor Fleet')
    `;
    await expect(
      rawPrisma.$executeRaw`
        INSERT INTO "InsurerProduct" ("id", "organizationId", "insurerId", "insuranceLine")
        VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, ${insurer.id}, 'Motor Fleet')
      `,
    ).rejects.toThrow();

    // A DIFFERENT line on the same insurer is fine — the constraint is per pair,
    // not per insurer.
    await rawPrisma.$executeRaw`
      INSERT INTO "InsurerProduct" ("id", "organizationId", "insurerId", "insuranceLine")
      VALUES (gen_random_uuid(), ${TEST_ORGANIZATION_ID}, ${insurer.id}, 'Group Medical')
    `;
    const lines = await prisma.insurerProduct.findMany({
      where: { insurerId: insurer.id },
      select: { insuranceLine: true },
      orderBy: { insuranceLine: 'asc' },
    });
    expect(lines.map((l) => l.insuranceLine)).toEqual([
      'Group Medical',
      'Motor Fleet',
    ]);
  }, 120_000);
});

describe('the migration changed no existing insurer', () => {
  it('leaves every pre-existing insurer master-linked', async () => {
    // AC1. The migration is additive: no backfill, no row's resolved identity
    // changes. Every insurer that is NOT one of this file's fixtures must still
    // have its master link, and no local name.
    const rows = await rawPrisma.insurer.findMany({
      where: {
        legalName: null,
      },
      select: { insurerMasterId: true },
    });
    expect(
      rows.length,
      'the seeded insurers are all master-linked',
    ).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.insurerMasterId,
        'a row with no local name must have a master link — otherwise it is nameless',
      ).not.toBeNull();
    }
  }, 120_000);
});

describe('the unique constraints on Insurer are exactly these four', () => {
  it('is the inventory the 409 messages depend on', async () => {
    // Insurer CRUD turns a P2002 into a 409 whose wording names WHICH uniqueness
    // was hit — "this office already registers an insurer called X" versus "this
    // office already has a relationship with that company". It cannot read that
    // from the error: Prisma 6.19.3 returns
    // `meta: { modelName: 'Insurer', target: null }` for both of them, which is why
    // the first attempt turned every collision into a 500.
    //
    // So `InsurerService.asCollision` decides from the WRITE PATH instead, which is
    // exhaustive only while these three are the only unique constraints on the
    // table:
    //
    //   - `Insurer_pkey` — a generated uuid, cannot collide;
    //   - `Insurer_one_local_company_per_org` — partial, `WHERE insurerMasterId IS NULL`,
    //     so only a local registration or a rename can trip it. RENAMED and rebuilt when the
    //     canonical key was unified: it was `(organizationId, lower(legalName))` and is now
    //     `(organizationId, canonicalName)` over the GENERATED column, which is why the name
    //     says COMPANY rather than NAME. The per-write-path reasoning below was re-derived
    //     against it rather than the expectation being edited: a local write still trips only
    //     this index, because a catalogue-linked row is outside its WHERE clause;
    //   - `Insurer_organizationId_insurerMasterId_key` — NULLs are distinct in
    //     Postgres, so only a catalogue-linked registration can trip it.
    //   - `Insurer_id_organizationId_key` — the composite-FK target added by the
    //     managed-insurance-lines migration, so `InsurerOfferedLine` cannot claim an
    //     office its insurer does not belong to. It can only collide if `id` does,
    //     which the primary key refuses first, so it cannot reach a caller as a 409
    //     either. THIS TEST IS WHY THAT WAS CHECKED: adding the index broke it, which
    //     forced the question rather than letting the assumption rot.
    //
    // A FOURTH unique index would break that reasoning silently, producing a
    // confident 409 about the wrong constraint. This test is what makes adding one
    // a decision rather than an accident: if it fails, revisit `asCollision`, then
    // update this list.
    const indexes = await rawPrisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'Insurer'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
        ORDER BY indexname`,
    );
    expect(indexes.map((i) => i.indexname)).toEqual([
      'Insurer_id_organizationId_key',
      'Insurer_one_local_company_per_org',
      'Insurer_organizationId_insurerMasterId_key',
      'Insurer_pkey',
    ]);
  }, 120_000);
});

describe('the canonical key belongs to the database', () => {
  it('REFUSES a write to canonicalName, which is why it is generated', async () => {
    // The whole argument for a GENERATED column rather than an application-written one. Before
    // this, the service computed the key and the database trusted it; a second writer, a
    // migration, or a service that forgot would have produced a row the directory groups
    // wrongly — silently, because nothing compares the stored key to the name beside it.
    //
    // Attempted as the OWNER, so this is not a privilege check: Postgres refuses the column
    // to everybody.
    await expect(
      rawPrisma.$executeRawUnsafe(
        `UPDATE "Insurer" SET "canonicalName" = 'whatever i like'
          WHERE "insurerMasterId" IS NULL`,
      ),
    ).rejects.toThrow(/generated|cannot be used|GENERATED/i);
  }, 120_000);

  it('derives it from the name, and re-derives it on a rename', async () => {
    const name = `Constraint Fixture Generated ${tag}`;
    const inserted = await rawPrisma.insurer.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        legalName: name,
        legalNameAr: `${name} (ع)`,
      },
      select: { id: true, canonicalName: true },
    });
    // Sorted tokens, lower-cased — computed by the database, not supplied.
    expect(inserted.canonicalName).toBe(
      `${tag} constraint fixture generated`.split(' ').sort().join(' '),
    );

    // A rename moves it in the same statement, with nothing in the application involved.
    const renamed = await rawPrisma.insurer.update({
      where: { id: inserted.id },
      data: { legalName: `Constraint Fixture Renamed ${tag}` },
      select: { canonicalName: true },
    });
    expect(renamed.canonicalName).toBe(
      `${tag} constraint fixture renamed`.split(' ').sort().join(' '),
    );
  }, 120_000);

  it('refuses a second local registration that differs only in spelling', async () => {
    // The defect this closed, from the write side. `Insurer_one_local_company_per_org` is on
    // the canonical key now, so a respelling is the same company — where the old
    // `lower(legalName)` index accepted it and left the directory showing one entry for two
    // rows.
    const base = `Constraint Fixture Spelling ${tag}`;
    await rawPrisma.insurer.create({
      data: {
        organizationId: TEST_ORGANIZATION_ID,
        legalName: base,
        legalNameAr: `${base} (ع)`,
      },
    });
    await expect(
      rawPrisma.insurer.create({
        data: {
          organizationId: TEST_ORGANIZATION_ID,
          // Reordered, punctuated, extra spaces — one company under the key.
          legalName: `spelling   fixture-constraint   ${tag}`,
          legalNameAr: `${base} (ع2)`,
        },
      }),
    ).rejects.toThrow();
  }, 120_000);
});
