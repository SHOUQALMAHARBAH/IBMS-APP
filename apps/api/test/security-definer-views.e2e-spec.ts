import { describe, expect, it } from 'vitest';
import { rawPrisma } from './tenant-prisma';
import { INSURER_DIRECTORY_COLUMNS } from '../src/repositories/insurer-directory.repository';

/**
 * The inventory of SECURITY DEFINER views, and what each one owes.
 *
 * ## Why this is not a test about the insurer directory
 *
 * `insurer-directory.e2e-spec.ts` proves that ONE view's columns are an allow-list and that
 * writes to it are refused. That is a test about one object, which is the shape this
 * codebase keeps replacing: it says nothing about the second such view, and the second such
 * view is the one that will be written in eighteen months by somebody who has read none of
 * this.
 *
 * So this file takes the same move one level up — the house pattern (IMPROVEMENTS.md
 * § 1.19): enumerate the whole SET from the authority, and require every member to be
 * declared. Today the registry has one entry. Its entire value is what happens on the day
 * somebody adds the second one: their view fails this test as soon as they create it, with a
 * message telling them what a security-definer view owes.
 *
 * ## What such a view owes, and why
 *
 * A view with `security_invoker = false` executes with its OWNER's privileges. The owner is
 * the table owner, who is not subject to the RLS policies on the tables underneath. So the
 * view is a legitimate, deliberate hole in row-level security — the only mechanism in this
 * codebase that can read across offices — and everything that makes it safe is a property of
 * the view's own definition rather than of any code path.
 *
 * Two obligations follow, and they are what the registry records:
 *
 *  1. **A declared column allow-list.** The app role can query the view directly, so every
 *     column on it is readable by anything that can write SQL. A column is either public
 *     data or it does not belong there; "the service does not map it" is not a boundary.
 *  2. **A write that is PROVEN refused.** `InsurerDirectory` happens to be read-only because
 *     an aggregating view is not auto-updatable in Postgres — and this database's default
 *     privileges GRANT INSERT/UPDATE/DELETE on new relations, so the grant is not what
 *     protects it. A future view without a GROUP BY would be auto-updatable and writable by
 *     the app role by default. The declared statement below is executed as `ibms_app` and
 *     must be refused.
 *
 * `relkind = 'r'` in `tenant-isolation.e2e-spec.ts` asserts that every tenant-scoped TABLE
 * arrives with RLS enabled and a policy. It excludes views by construction, which is exactly
 * the gap this file closes.
 */

interface SecurityDefinerViewContract {
  /** Exactly the columns the view may expose. Referenced, never copied — a second copy of an
   *  allow-list is a second answer to "what may cross an office boundary". */
  columns: readonly string[];
  /** A write the app role must NOT be able to perform, executed verbatim below. */
  refusedWrite: string;
  /** Why this view is allowed to cross the boundary at all. */
  why: string;
}

/**
 * Every SECURITY DEFINER view in this database, and its contract.
 *
 * Adding a view with `security_invoker = false` and not adding it here fails the first test
 * below. That is deliberate: the declaration IS the review.
 */
const SECURITY_DEFINER_VIEWS: Record<string, SecurityDefinerViewContract> = {
  InsurerDirectory: {
    columns: INSURER_DIRECTORY_COLUMNS,
    refusedWrite: 'DELETE FROM "InsurerDirectory"',
    why: "The cross-office insurer directory. Aggregates every office's Insurer rows into one entry per company, exposing only public company facts — see docs/insurer-directory.md.",
  },
};

/** Views owned by the app's owner role that run with the owner's privileges. `reloptions`
 *  carries `security_invoker=true` only when explicitly set, so absence means false, which
 *  is the classic (and here deliberate) behaviour. */
async function securityDefinerViews(): Promise<string[]> {
  const rows = await rawPrisma.$queryRawUnsafe<{ relname: string }[]>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'v'
        AND (c.reloptions IS NULL
             OR NOT ('security_invoker=true' = ANY(c.reloptions)))
      ORDER BY c.relname`,
  );
  return rows.map((r) => r.relname);
}

const APP_DB_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://ibms_app:ibms_app_dev@localhost:5434/ibms_test?schema=public';

/** Runs one statement as `ibms_app`, the role the API itself uses. */
async function asAppRole(sql: string): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: APP_DB_URL } } });
  try {
    await client.$executeRawUnsafe(sql);
  } finally {
    await client.$disconnect();
  }
}

describe('every SECURITY DEFINER view is declared', () => {
  it('has no undeclared members', async () => {
    const found = await securityDefinerViews();
    const declared = Object.keys(SECURITY_DEFINER_VIEWS);
    const undeclared = found.filter((v) => !declared.includes(v));
    expect(
      undeclared,
      "a SECURITY DEFINER view runs with its OWNER's privileges, so it reads PAST the RLS policies on the tables underneath — it is a deliberate hole in row-level security. Every one owes a declared column allow-list (the app role can query it directly, so any column on it is readable by anything that can write SQL) and a write proven refused (an aggregating view is read-only by accident; one without a GROUP BY is writable by default in this database). Declare it in SECURITY_DEFINER_VIEWS with both, and read docs/insurer-directory.md for the precedent",
    ).toEqual([]);
  }, 120_000);

  it('declares nothing that does not exist', async () => {
    // The other direction: a stale registry entry would make the test above pass by
    // describing a view that was renamed or dropped.
    const found = await securityDefinerViews();
    const missing = Object.keys(SECURITY_DEFINER_VIEWS).filter(
      (v) => !found.includes(v),
    );
    expect(
      missing,
      'declared but not present as a security-definer view — renamed, dropped, or switched to security_invoker = true',
    ).toEqual([]);
  }, 120_000);
});

describe('each declared view keeps its contract', () => {
  for (const [view, contract] of Object.entries(SECURITY_DEFINER_VIEWS)) {
    it(`${view} exposes exactly its allow-listed columns`, async () => {
      const columns = await rawPrisma.$queryRawUnsafe<
        { column_name: string }[]
      >(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${view}'
          ORDER BY column_name`,
      );
      expect(
        columns.map((c) => c.column_name).sort(),
        `${view}: ${contract.why} — a column added here is readable by every office. Add it to the allow-list only if it is genuinely public data.`,
      ).toEqual([...contract.columns].sort());
    }, 120_000);

    it(`${view} refuses the write it declares`, async () => {
      // Executed as the real app role, not the owner. This is the assertion that keeps
      // passing for the WRONG reason if the view is ever replaced by a real table — see
      // IMPROVEMENTS.md § 1.21, which makes re-establishing the guarantee a condition on any
      // successor rather than something to be noticed afterwards.
      await expect(asAppRole(contract.refusedWrite)).rejects.toThrow();
    }, 120_000);
  }
});
