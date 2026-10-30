#!/usr/bin/env node
/**
 * Run one SQL statement against a given database URL and print the result the way `psql -tA` does.
 *
 *     node scripts/scratch-sql.mjs <url> <sql>
 *
 * ## WHY THIS EXISTS — item 1, batch 5 group 7
 *
 * `from-empty.sh` reached postgres through `docker exec` into the local `ibms-app-db-test-1`
 * compose container on port 5434, and SKIPPED WITH `exit 0` when that container was absent. Its own
 * output says *"this is a skip, NOT a pass"*, and that reasoning is right for a laptop — a gate
 * that goes red for an environmental reason is one everybody learns to ignore.
 *
 * It is WRONG for CI, where the environment is guaranteed. Dropping that script into a CI step
 * unchanged would have produced a green step that printed "SKIPPED" on every run forever: a gate
 * that never runs, which is the exact defect the step was added to fix, reproduced inside the fix.
 * CI's postgres is a SERVICE container on localhost:5432 with no name to `docker exec` into.
 *
 * ## WHY PRISMA RATHER THAN psql
 *
 * MEASURED: `psql` is not on PATH on the development machine — which is why the script used
 * `docker exec` in the first place — and no CI step uses it either. What CI demonstrably has is
 * `PrismaClient` plus a URL: `check-app-role-privileges.mjs`, `check-schema-divergence.mjs` and
 * `check-migration-checksums.mjs` all run that way and all run in CI today. So this helper depends
 * on nothing that is not already proven to work in both places.
 *
 * ## IT REPRODUCES `psql -tA` EXACTLY, because nineteen assertions compare against its output
 *
 * `-t` is tuples only (no header, no row count) and `-A` is unaligned with `|` between fields. So
 * rows join with a newline, fields join with `|`, and NULL prints as the empty string. Assertions
 * in that script compare against `true|true` and `GO Global`, so any other shape silently breaks
 * them — and a comparison against a differently-shaped string is a gate that fails for the wrong
 * reason, or passes for one.
 */
import { PrismaClient } from '@prisma/client';

const [url, sql] = process.argv.slice(2);
if (!url || !sql) {
  console.error('usage: node scripts/scratch-sql.mjs <url> <sql>');
  process.exit(2);
}

const prisma = new PrismaClient({ datasourceUrl: url });
try {
  /*
   * `$queryRawUnsafe` for a SELECT and `$executeRawUnsafe` for everything else. CREATE DATABASE and
   * DROP DATABASE cannot run inside a transaction, and `$executeRawUnsafe` does not open one — which
   * is the whole reason the admin statements go through this path rather than an interactive one.
   */
  const isSelect = /^\s*(select|with|show|table)\b/i.test(sql);
  if (!isSelect) {
    await prisma.$executeRawUnsafe(sql);
  } else {
    const rows = await prisma.$queryRawUnsafe(sql);
    const out = rows
      .map((row) =>
        Object.values(row)
          .map((v) => {
            // `psql -tA` renders NULL as empty, a bigint as digits, and a boolean as `true`/`false`
            // — not `t`/`f`. The script's own comment records paying for that distinction once.
            if (v === null || v === undefined) return '';
            if (typeof v === 'bigint') return v.toString();
            return String(v);
          })
          .join('|'),
      )
      .join('\n');
    if (out !== '') process.stdout.write(out + '\n');
  }
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
