import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rawPrisma } from './tenant-prisma';

/**
 * MODULE 0 ITEM (b) — what the database guarantees about `Organization.brokerKind`.
 *
 * CBJ Instructions No. 9 of 2026, art. 3/a: a NATURAL PERSON broker is a sole establishment and may
 * hold ONE insurance type only; a CORPORATE broker may hold both. This file does NOT test that
 * rule — no column stores a licence scope yet, so there is nothing to compare a kind against. Item
 * (e) is where the scope becomes data and where the refusal belongs. What is testable now is that
 * every brokerage office HAS a kind for (e) to check, and that an insurer does not carry one.
 *
 * ## Why these assertions are at the database and not in a service
 *
 * The column is NULLABLE, because NULL is the correct value for an insurance company. That makes
 * it OPTIONAL in Prisma's `CreateInput`, so the compiler cannot ask a caller for it — measured:
 * adding the column broke exactly ONE typecheck (the in-memory `Organization` fixture, which uses
 * the full model type) and none of the seven `organization.create` sites. The CHECK constraint is
 * therefore the only thing that refuses a brokerage office with no kind.
 *
 * ## Every write rolls back, and rolls back EVEN WHEN THE CONSTRAINT IS GONE
 *
 * The two refusal tests throw a sentinel after their INSERT rather than relying on the INSERT
 * failing. Item (a)'s equivalent test did rely on it, and planting the constraint away made the
 * INSERT succeed, COMMIT, and leak a row into the cumulative db-test — which then broke a sibling
 * test and blocked the constraint from being restored. A test that only rolls back by failing
 * leaks the moment the thing it guards stops working.
 */

const ROLLBACK = 'rollback: nothing in this test may outlive it';
const CHECK_NAME = 'Organization_broker_kind_matches_type';

const INSERT =
  'INSERT INTO "Organization" (id, "legalName", subdomain, "updatedAt", "type", "brokerKind")' +
  ' VALUES ($1, $2, $3, now(), $4::"OrganizationType", $5::"BrokerKind")';

/** One attempted Organization, always rolled back. Resolves to the error thrown, or to the
 *  sentinel when the database accepted a row it should have refused. */
async function attempt(
  kind: 'BROKERAGE_OFFICE' | 'INSURANCE_COMPANY',
  brokerKind: 'NATURAL_PERSON' | 'CORPORATE' | null,
): Promise<{ id: string; error: unknown }> {
  const id = randomUUID();
  let error: unknown = null;
  try {
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        INSERT,
        id,
        `probe ${id}`,
        `probe-${id}`,
        kind,
        brokerKind,
      );
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    error = e;
  }
  // Proven, not assumed: whichever way the transaction ended, no row survives it.
  const survivors = await rawPrisma.organization.count({ where: { id } });
  expect(
    survivors,
    'the probe organization must not outlive its transaction',
  ).toBe(0);
  return { id, error };
}

describe('Organization.brokerKind — the database guarantees', () => {
  it('carries exactly the two kinds art. 3/a names', async () => {
    const rows = await rawPrisma.$queryRawUnsafe<{ labels: string }[]>(
      `SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'BrokerKind'`,
    );
    expect(rows[0]?.labels).toBe('NATURAL_PERSON,CORPORATE');
  });

  it('is guarded by a CHECK whose predicate still names BOTH columns', async () => {
    const rows = await rawPrisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
        WHERE c.conrelid = '"Organization"'::regclass AND c.conname = $1`,
      CHECK_NAME,
    );
    const def = rows[0]?.def;
    // Asserting the constraint EXISTS is not enough: a predicate loosened to `TRUE OR (...)`
    // satisfies a name check and refuses nothing. The same reasoning as migration 20261028100000.
    expect(def, `${CHECK_NAME} does not exist`).toBeTruthy();
    expect(def).toContain('brokerKind');
    expect(def).toContain('type');
  });

  it('refuses a brokerage office that does not say what kind of broker it is', async () => {
    const { error } = await attempt('BROKERAGE_OFFICE', null);
    // 23514 is check_violation. Both the code and the constraint NAME are required: the code alone
    // would still pass if a second, unrelated CHECK were added to this table later and fired
    // instead — which is a real possibility, since items (d)-(g) add more office-level rules.
    expect(String(error)).toMatch(/23514/);
    expect(String(error)).toContain(CHECK_NAME);
  });

  it('refuses an insurance company that carries a broker kind', async () => {
    // The other direction, which a one-sided constraint would miss. "Broker kind" is meaningless
    // for an insurer, and a value nothing reads is a value somebody will eventually read.
    const { error } = await attempt('INSURANCE_COMPANY', 'CORPORATE');
    expect(String(error)).toMatch(/23514/);
    expect(String(error)).toContain(CHECK_NAME);
  });

  it('accepts a sole establishment and a corporate broker alike', async () => {
    for (const kind of ['NATURAL_PERSON', 'CORPORATE'] as const) {
      const { error } = await attempt('BROKERAGE_OFFICE', kind);
      // Reaching the sentinel is what proves the row was ACCEPTED — the only way out of that
      // transaction other than a database refusal.
      expect(String(error), `a ${kind} brokerage office was refused`).toContain(
        ROLLBACK,
      );
    }
  });

  it('accepts an insurance company with no broker kind', async () => {
    const { error } = await attempt('INSURANCE_COMPANY', null);
    expect(String(error)).toContain(ROLLBACK);
  });

  it('left every existing brokerage office with a kind', async () => {
    const brokerages = await rawPrisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE' },
    });
    // Non-vacuity first: "every brokerage office has a kind" is also true of no brokerage offices.
    expect(
      brokerages,
      'no brokerage offices — the next assertion would be vacuous',
    ).toBeGreaterThan(0);

    const withAKind = await rawPrisma.organization.count({
      where: { type: 'BROKERAGE_OFFICE', brokerKind: { not: null } },
    });
    expect(withAKind).toBe(brokerages);
  });
});
