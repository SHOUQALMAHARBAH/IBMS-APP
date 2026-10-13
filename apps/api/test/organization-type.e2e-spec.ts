import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rawPrisma } from './tenant-prisma';

/**
 * MODULE 0 ITEM (a) — the four database guarantees behind "an Organization says what kind it is".
 *
 * Every assertion here reads the CATALOGUE or writes with the OWNER connection and raw SQL, never
 * through Prisma's typed client, because the claim is about the DATABASE. TypeScript already
 * refuses an `organization.create` with no `type` — that is how seven call sites and one in-memory
 * fixture were found — but a type is not a control: it is absent from raw SQL, from a migration,
 * and from anything that reaches this table without going through the generated client.
 *
 * ## No Nest app, deliberately
 *
 * `rawPrisma` is a standalone client, so this file needs no `createTestApp()` and none of its
 * 300-second budget. Nothing here goes through a route.
 *
 * ## Why every write rolls back
 *
 * db-test is cumulative and shared by every api e2e spec, and a second live Organization makes
 * `signup` refuse — which has already cost one run 17 unrelated failures. So the two tests that
 * write do it inside `$transaction` and leave nothing behind, and each then asserts the row is
 * actually gone rather than trusting that it rolled back.
 */

const ROLLBACK = 'rollback: the organization in this test must not outlive it';

/** The columns a raw INSERT must supply: `updatedAt` is NOT NULL with NO database default
 *  (Prisma's `@updatedAt` is applied client-side), while `status`, `createdAt` and
 *  `dutySegregationMode` all carry one. Measured off `pg_attrdef`, not guessed. */
const INSERT_WITHOUT_TYPE =
  'INSERT INTO "Organization" (id, "legalName", "legalNameAr", subdomain, "updatedAt") VALUES ($1, $2, $2, $3, now())';
const INSERT_WITH_TYPE =
  'INSERT INTO "Organization" (id, "legalName", "legalNameAr", subdomain, "updatedAt", "type") VALUES ($1, $2, $2, $3, now(), $4::"OrganizationType")';

describe('Organization.type — the database guarantees', () => {
  it('carries exactly the two intended kinds, in order', async () => {
    const rows = await rawPrisma.$queryRawUnsafe<{ labels: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'OrganizationType'`,
    );
    // A kind appearing here that is not in this list is a new kind of organization nobody decided
    // on — the same reason the migration asserts the set rather than merely asserting the type
    // exists. It fired as designed when item (j)'s gap closure added the third.
    //
    // `PROVIDER` was that decision (migration `20261117100000`): the platform operator, which item
    // (j) shipped as inexpressible and the closure made expressible. A FOURTH label is still an
    // undecided kind and still fails here.
    //
    // THE ORDER IS LOAD-BEARING AND NOT MERELY COSMETIC. `enumsortorder` is the order the labels
    // were added, and `PROVIDER` had to be added in its own migration precisely because the next
    // one's partial unique index names the label in its WHERE clause — so a reordering here would
    // mean the enum was rebuilt rather than appended to.
    expect(rows[0]?.labels).toBe('BROKERAGE_OFFICE,INSURANCE_COMPANY,PROVIDER');
  });

  it('is NOT NULL and carries NO default — which is the decision, not an oversight', async () => {
    const rows = await rawPrisma.$queryRawUnsafe<
      { not_null: boolean; has_default: boolean }[]
    >(
      `SELECT a.attnotnull AS not_null, a.atthasdef AS has_default
         FROM pg_attribute a
        WHERE a.attrelid = '"Organization"'::regclass
          AND a.attname = 'type' AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    expect(rows[0]?.not_null).toBe(true);
    // The half that would rot silently. A default here would not protect anything — neither kind
    // is a safe fallback for the other — it would only decide, quietly, the kind a caller forgot
    // to name, and the first symptom would be an insurance company holding a broker licence.
    expect(rows[0]?.has_default).toBe(false);
  });

  it('refuses an organization that does not say which kind it is', async () => {
    const id = randomUUID();
    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          INSERT_WITHOUT_TYPE,
          id,
          'Office with no stated kind',
          `no-kind-${id}`,
        );
        // UNREACHABLE while the column is NOT NULL, and here precisely for when it is not.
        //
        // Found by planting: with the NOT NULL dropped on db-test, the INSERT above SUCCEEDED, so
        // this transaction COMMITTED and left a typeless Organization behind — which then broke
        // the backfill test below and made `SET NOT NULL` impossible to restore. A test that only
        // rolls back by failing is a test that leaks the moment the thing it guards stops working.
        // Now it rolls back either way, and the assertion below still fails under that plant
        // because the message is this sentinel rather than the SQLSTATE.
        throw new Error(ROLLBACK);
      }),
      // Not a TypeScript error and not a service check: the DATABASE refuses it, so deleting every
      // line of application code cannot produce a typeless organization.
      //
      // Asserted on the SQLSTATE rather than on prose. Prisma surfaces a raw-query failure as
      // "Raw query failed. Code: `23502`" plus Postgres's DETAIL line, and does NOT pass through
      // the "null value in column ..." primary message — so a regex naming the column passes
      // against nothing. 23502 is `not_null_violation`.
      //
      // WHY THE CODE ALONE PINS `type`: of this table's NOT NULL columns, `status`, `createdAt`
      // and `dutySegregationMode` carry database defaults, and the INSERT above supplies `id`,
      // `legalName`, `legalNameAr`, `subdomain` and `updatedAt` — every other one. `type` is
      // therefore the only column that can be null here, which is what makes a bare code
      // assertion sufficient rather than merely passing.
      //
      // `legalNameAr` IS IN THAT LIST DELIBERATELY, and it is the reason this comment moved.
      // Module 0-ب made it NOT NULL, which would otherwise have made THIS test pass for the wrong
      // reason: the INSERT would raise 23502 about the Arabic name while the assertion claimed it
      // was about `type`, and a later change making `type` nullable would not have been caught.
    ).rejects.toThrow(/23502/);

    const survivors = await rawPrisma.organization.count({ where: { id } });
    expect(survivors, 'the refused organization must not exist').toBe(0);
  });

  it('accepts an INSURANCE_COMPANY — the capability exists, not just the enum label', async () => {
    const id = randomUUID();
    await expect(
      rawPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          INSERT_WITH_TYPE,
          id,
          'An Insurance Company',
          `insurer-org-${id}`,
          'INSURANCE_COMPANY',
        );
        const rows = await tx.$queryRawUnsafe<{ kind: string }[]>(
          'SELECT "type"::text AS kind FROM "Organization" WHERE id = $1',
          id,
        );
        // Read back INSIDE the transaction: asserting only that the INSERT did not throw would
        // pass against a column that silently stored something else.
        expect(rows.map((r) => r.kind)).toEqual(['INSURANCE_COMPANY']);
        throw new Error(ROLLBACK);
      }),
    ).rejects.toThrow(ROLLBACK);

    const survivors = await rawPrisma.organization.count({ where: { id } });
    expect(
      survivors,
      'the test organization must not outlive the rollback',
    ).toBe(0);
  });

  it('left every pre-existing office as a brokerage office', async () => {
    const total = await rawPrisma.organization.count();
    // Non-vacuity first: "all rows are BROKERAGE_OFFICE" is also true of an empty table, and this
    // assertion is about a backfill that has to have reached something.
    expect(
      total,
      'no organizations at all — the next assertion would be vacuous',
    ).toBeGreaterThan(0);

    const brokerages = await rawPrisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    expect(
      brokerages,
      'the backfill must have reached at least one office',
    ).toBeGreaterThan(0);

    /*
     * THE DENOMINATOR MOVED, AND THAT IS WHY THIS IS NOT `brokerages === total` ANY MORE.
     *
     * Item (a)'s claim is about its own BACKFILL: every row that existed when the migration ran
     * came out of it a brokerage office. That claim is unchanged. What changed is that the seed now
     * creates a PROVIDER organization AFTER the backfill (item (j)'s gap closure), so "every
     * organization is a brokerage office" is no longer the same sentence as "the backfill reached
     * every row" — and asserting the first would be asserting something item (a) never claimed.
     *
     * Written as "nothing is of a type nobody decided to create" rather than as a count, so it
     * still fails for the cases this test exists for: a row left INSURANCE_COMPANY by a bad
     * backfill, and a SECOND provider slipping past the partial unique. A plain `total - 1` would
     * pass against either.
     */
    const unexpected = await rawPrisma.$queryRawUnsafe<
      { kind: string; subdomain: string }[]
    >(
      `SELECT "type"::text AS kind, "subdomain" FROM "Organization" WHERE "type" NOT IN ('BROKERAGE_OFFICE', 'PROVIDER')`,
    );
    expect(
      unexpected,
      'an organization of a kind item (a) did not backfill and item (j) did not seed',
    ).toEqual([]);

    const providers = await rawPrisma.organization.count({
      where: { type: 'PROVIDER' },
    });
    // At most one, which the partial unique `Organization_one_provider` already refuses — asserted
    // here too because this is the test that reads the whole table, and `db:divergence` is blind to
    // a partial index.
    expect(providers, 'at most one platform operator').toBeLessThanOrEqual(1);
    // DEFENSIVE, and named as such rather than counted as proven: no plant on this file can
    // make the arithmetic disagree, because nothing here WRITES an organization. The query
    // above is the detector — pointed at `NOT IN ('BROKERAGE_OFFICE')` it names the provider
    // and the test dies, which is what proves it reads rows rather than passing on an empty
    // set. This line is the second way the same wrong state would surface.
    expect(brokerages + providers).toBe(total);
  });
});
