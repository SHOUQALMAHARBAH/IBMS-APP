import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma as rawPrisma } from './tenant-prisma';

/**
 * THE DECLARED-ACT RECORD, PROVEN AT THE DATABASE — module-1 paper §٨, OWNER DECISION 126.
 *
 * ## WHY THIS SPEC EXISTS AT ALL, GIVEN THERE IS NO ROUTE YET
 *
 * Message 36 §3 is server-and-database only; the route that writes a declared act arrives with
 * art. 15/d in §4. So there is nothing to call over HTTP — and the two guarantees that matter most
 * are not HTTP guarantees in any case:
 *
 *   ELEMENT 7  the record is append-only «بأيِّ صلاحية» — under EVERY permission. A permission
 *              model cannot express that, because any model that can grant "edit" can be
 *              configured to grant it. Two database triggers are the guarantee.
 *   RLS        one office must never read another's admitted breaches. This is the second table in
 *              the repository with `FORCE ROW LEVEL SECURITY`, so even the table's OWNER is
 *              subject — and layer 2 is observable only by going around layer 1.
 *
 * Both were measured by hand when the migration landed. That proved them ONCE. This spec is what
 * keeps them proven, which is the whole difference.
 *
 * ## 🔴 EVERY PROBE RUNS INSIDE A TRANSACTION THAT ABORTS OR ROLLS BACK, AND IT HAS TO
 *
 * The record is APPEND-ONLY. A probe row written and committed here could never be removed —
 * `DELETE` is refused by trigger, for everyone, which is the point. db-test is cumulative, so a
 * single committed probe would be permanent test residue in a table that an inspector's report
 * reads. Clearing it would need the trigger disabled and re-enabled by hand, which is exactly
 * what `company-record-shape.e2e-spec.ts`'s header records having had to do for `AuditLogEntry`.
 *
 * A `RAISE` from a BEFORE trigger aborts its transaction, which rolls the INSERT back for free —
 * so the refusal probes clean up by failing. The one probe that must SUCCEED is rolled back
 * explicitly. The final assertion counts the rows left behind and expects zero.
 *
 * ## THE CONNECTION
 *
 * `APP_DATABASE_URL` — the role the API itself uses. The suite's own client is the table OWNER and
 * on db-test that role is a SUPERUSER with BYPASSRLS, so an RLS refusal asserted through it would
 * pass with every policy dropped. The FIRST test asserts this connection is not exempt;
 * `check:rls-proof-shape` requires exactly that of any spec claiming RLS refuses something.
 */

/** The app role's own connection — the one RLS actually applies to. */
const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

/**
 * Runs statements as the APPLICATION role, optionally with `app.current_org_id` set, inside ONE
 * transaction that is always rolled back. Returns the rows of the last `SELECT`, or throws the
 * database's own error — which is what the refusal probes assert on.
 */
async function asAppRole<T>(
  organizationId: string | null,
  statements: string[],
): Promise<T[]> {
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    let last: unknown[] = [];
    await client
      .$transaction(async (tx) => {
        if (organizationId !== null) {
          await tx.$executeRawUnsafe(
            `SELECT set_config('app.current_org_id', '${organizationId}', true)`,
          );
        }
        for (const sql of statements) {
          last = await tx.$queryRawUnsafe(sql);
        }
        // ALWAYS roll back. Nothing this spec writes may survive it.
        throw new Error('__rollback__');
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === '__rollback__') return;
        throw err;
      });
    return last as T[];
  } finally {
    await client.$disconnect();
  }
}

let officeId = '';
let otherOrgId = '';
let actorUserId = '';

/** A complete, valid row — every CHECK cleared — so a refusal is never the wrong refusal. The
 *  `provider-office-state` lesson: a fixture that fails a NOT NULL instead of the constraint under
 *  test passes forever while proving nothing. */
function insertSql(orgId: string, overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    id: `gen_random_uuid()::text`,
    organizationId: `'${orgId}'`,
    site: `'ARTICLE_15_D_FEWER_THAN_THREE_INSURERS'`,
    articleRef: `'15/d'`,
    articleTextShown: `repeat('article text as displayed ', 3)`,
    acknowledgementTextShown: `repeat('acknowledgement as displayed ', 3)`,
    responsibilitySentence: `repeat('responsibility sentence ', 2)`,
    reason: `'a reason long enough to clear the shared floor'`,
    permissionCode: `'declared-act.article-15-d.declare'`,
    entity: `'RFQ'`,
    entityId: `'e2e-probe'`,
    transactionRef: `'TX-E2E'`,
    actorUserId: `'${actorUserId}'`,
    actorNameShown: `'E2E Probe Actor'`,
    ...overrides,
  };
  const cols = Object.keys(values)
    .map((c) => `"${c}"`)
    .join(',');
  return `INSERT INTO "DeclaredAct" (${cols}) VALUES (${Object.values(values).join(',')}) RETURNING id`;
}

beforeAll(async () => {
  const office = await rawPrisma.organization.findFirstOrThrow({
    where: { type: 'BROKERAGE_OFFICE' },
    select: { id: true },
  });
  officeId = office.id;
  const other = await rawPrisma.organization.findFirstOrThrow({
    where: { id: { not: officeId } },
    select: { id: true },
  });
  otherOrgId = other.id;
  const user = await rawPrisma.user.findFirstOrThrow({
    where: { organizationId: officeId },
    select: { id: true },
  });
  actorUserId = user.id;
}, 120_000);

afterAll(async () => {
  // THE ASSERTION THAT MATTERS MOST FOR A CUMULATIVE DATABASE: this spec left nothing behind.
  // Scoped to its own sentinel so a real declaration written by another spec is not counted.
  const left = await rawPrisma.declaredAct.count({
    where: { entityId: 'e2e-probe' },
  });
  if (left !== 0) {
    throw new Error(
      `declared-act e2e left ${left} row(s) in an APPEND-ONLY table. They cannot be deleted by any permission — the trigger refuses it — so this is permanent residue and the probe transactions did not roll back.`,
    );
  }
}, 120_000);

describe('the connection these refusals travel on is not exempt', () => {
  it('connects as a role that is neither SUPERUSER nor BYPASSRLS, and owns nothing', async () => {
    const who = await asAppRole<{
      u: string;
      s: boolean;
      b: boolean;
      owned: bigint;
    }>(null, [
      `SELECT current_user AS u,
              (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS s,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS b,
              (SELECT count(*) FROM pg_tables
                WHERE schemaname = 'public' AND tableowner = current_user) AS owned`,
    ]);
    expect(who).toHaveLength(1);
    expect(
      who[0].s,
      `connected as ${who[0].u}, a SUPERUSER — RLS does not apply to it, so every refusal below would pass with every policy dropped`,
    ).toBe(false);
    expect(who[0].b, `connected as ${who[0].u}, which holds BYPASSRLS`).toBe(
      false,
    );
    // Ownership too: Postgres exempts a table's owner from its own policies, and `rolsuper`/
    // `rolbypassrls` both false does not cover that. `DeclaredAct` is FORCED, which closes it —
    // asserted anyway, because the next tenant table probably will not be.
    expect(
      Number(who[0].owned),
      `${who[0].u} owns tables in public`,
    ).toBe(0);
  }, 120_000);

  it('and the table it is about is ENABLED **and FORCED**, which only two tables in this database are', async () => {
    const rls = await asAppRole<{ enabled: boolean; forced: boolean }>(null, [
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class WHERE relname = 'DeclaredAct'`,
    ]);
    expect(rls[0].enabled).toBe(true);
    expect(
      rls[0].forced,
      'DeclaredAct is no longer FORCE ROW LEVEL SECURITY. Enabled alone exempts the table OWNER, and for a register of admitted regulatory breaches the owner connection is exactly the one that must not be exempt.',
    ).toBe(true);
  }, 120_000);
});

describe('ELEMENT 7 — the record is append-only under EVERY permission', () => {
  it('a row can be written under the office’s own context', async () => {
    // The permissive half first. Without it the two refusals below would pass against a table
    // nothing can write at all, which is the hollow shape this register keeps finding.
    const rows = await asAppRole<{ id: string }>(officeId, [
      insertSql(officeId),
    ]);
    expect(rows).toHaveLength(1);
  }, 120_000);

  it('UPDATE is refused by the trigger, and the message names the element', async () => {
    await expect(
      asAppRole(officeId, [
        insertSql(officeId),
        `UPDATE "DeclaredAct" SET "reason" = 'rewritten after the fact' WHERE "entityId" = 'e2e-probe' RETURNING id`,
      ]),
    ).rejects.toThrow(/append-only/i);
  }, 120_000);

  it('DELETE is refused by the trigger', async () => {
    await expect(
      asAppRole(officeId, [
        insertSql(officeId),
        `DELETE FROM "DeclaredAct" WHERE "entityId" = 'e2e-probe' RETURNING id`,
      ]),
    ).rejects.toThrow(/append-only/i);
  }, 120_000);
});

describe('the CHECKs refuse what the service also refuses', () => {
  it('ELEMENT 2 — a reason below the shared floor of ten', async () => {
    await expect(
      asAppRole(officeId, [insertSql(officeId, { reason: `'too short'` })]),
    ).rejects.toThrow(/DeclaredAct_reason_meets_the_shared_floor/);
  }, 120_000);

  it('ELEMENTS 1/4/6 — a shown text that is a token rather than prose', async () => {
    // «النصُّ الحرفيُّ للإقرارِ والسببِ لا كلمةُ «نعم»» — the verbatim text, not the word yes.
    await expect(
      asAppRole(officeId, [
        insertSql(officeId, { acknowledgementTextShown: `'نعم'` }),
      ]),
    ).rejects.toThrow(/DeclaredAct_acknowledgementTextShown_is_prose/);
  }, 120_000);

  it('ELEMENT 5 — a declaration that cannot say which transaction it belongs to', async () => {
    await expect(
      asAppRole(officeId, [insertSql(officeId, { transactionRef: `'   '` })]),
    ).rejects.toThrow(/DeclaredAct_identifies_what_it_declares/);
  }, 120_000);
});

describe('one office never reads another’s admitted breaches', () => {
  it('a different office’s context sees none of them', async () => {
    const rows = await asAppRole<{ n: bigint }>(officeId, [
      insertSql(officeId),
      `SELECT count(*) AS n FROM "DeclaredAct" WHERE "entityId" = 'e2e-probe'`,
    ]);
    expect(Number(rows[0].n)).toBe(1);

    // Same row, a different tenant context, within its own rolled-back transaction.
    const seen = await asAppRole<{ n: bigint }>(otherOrgId, [
      `SELECT count(*) AS n FROM "DeclaredAct" WHERE "entityId" = 'e2e-probe'`,
    ]);
    expect(Number(seen[0].n)).toBe(0);
  }, 120_000);

  it('and no tenant context at all sees none — the policy is fail-closed', async () => {
    // `current_setting(..., true)` is NULL when unset and `col = NULL` is NULL, never true. A
    // policy written the other way round would make an unscoped connection see EVERYTHING.
    const seen = await asAppRole<{ n: bigint }>(null, [
      `SELECT count(*) AS n FROM "DeclaredAct"`,
    ]);
    expect(Number(seen[0].n)).toBe(0);
  }, 120_000);

  it('RLS refuses one office writing a row that belongs to another', async () => {
    await expect(
      asAppRole(otherOrgId, [insertSql(officeId)]),
    ).rejects.toThrow(/row-level security/i);
  }, 120_000);
});
