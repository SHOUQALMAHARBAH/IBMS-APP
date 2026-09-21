#!/usr/bin/env node
/**
 * Every applied migration's stored checksum must match its file on disk.
 *
 * ## Why this exists as its own gate
 *
 * Prisma records the sha256 of each migration file in `_prisma_migrations.checksum`. Editing an
 * applied migration — even to fix a comment — makes the stored value disagree with the file,
 * and then nobody can tell whether the SQL that ran is the SQL that is written down.
 *
 * `prisma migrate status` does NOT notice. Measured: with a drifted migration present it
 * reported "Database schema is up to date!". Only `migrate dev` complains, and this project
 * cannot use `migrate dev` at all (it wants to reset the dev database over a pre-existing
 * drift, which is why `packages/db/prisma/migrations/README` records the non-destructive
 * apply-then-`migrate resolve` route). So the gate in `scripts/verify.sh` that was labelled
 * "Database Migrations (drift check)" was checking something else entirely — its name claimed
 * a guarantee it did not provide.
 *
 * So the check is over the WHOLE SET (IMPROVEMENTS.md § 1.19): every applied migration, not
 * the one we happen to know about. That distinction was not theoretical — the first run found
 * ONE drift on db-test and FIVE on dev, of which exactly one was known. A check written for
 * the instance we knew about would have found the instance we knew about.
 *
 * Four of those five had a stored hash matching NO committed version of the file: the migration
 * was applied to dev while it was still being authored, then the file was edited before being
 * committed. Git cannot say what such a draft contained, so they were closed by measuring the
 * schema instead — see § 1.29 for the two measurements and why they were complete rather than
 * suggestive.
 *
 * `migrate resolve` is a drift source in its own right, so expect this to recur: it records the
 * hash of the file AS IT IS AT RESOLVE TIME (its rows show `applied_steps_count = 0`), and this
 * project's documented non-destructive route uses it. Any later edit to that file drifts it.
 *
 * ## What a failure means, and what to do
 *
 * The file was edited after being applied. Before touching anything, find out WHAT changed —
 * `git log -p` on that migration — because the answer decides the fix:
 *
 *  - comments only: the SQL that ran is the SQL that is written, so re-align the stored hash;
 *  - SQL changed: the databases were built from something the file no longer says. Re-aligning
 *    the hash would make that permanent and invisible. Write a NEW migration that brings the
 *    schema to what the edited file describes, and leave the original alone.
 *
 * ## Why there is no `--fix` flag
 *
 * Normalising a drift erases the evidence of what drifted, and the two cases above need
 * opposite responses — so a one-keystroke re-align would destroy the only record of which case
 * this was, in the name of a green gate. Of the five drifts above, the one that could be
 * re-aligned safely was safe only BECAUSE its diff had been read first (`8c300b8`: a single
 * comment line, no SQL). This script therefore reports and refuses to decide.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function fileChecksums() {
  const out = new Map();
  for (const name of readdirSync(MIGRATIONS_DIR)) {
    const dir = join(MIGRATIONS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const sql = join(dir, 'migration.sql');
    try {
      out.set(name, createHash('sha256').update(readFileSync(sql)).digest('hex'));
    } catch {
      // A directory with no migration.sql is not this check's business.
    }
  }
  return out;
}

const prisma = new PrismaClient();
try {
  const applied = await prisma.$queryRawUnsafe(
    'SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
  );
  const files = fileChecksums();

  const drifted = [];
  const missingFile = [];
  for (const row of applied) {
    const expected = files.get(row.migration_name);
    if (expected === undefined) {
      missingFile.push(row.migration_name);
    } else if (expected !== row.checksum) {
      drifted.push({
        name: row.migration_name,
        stored: row.checksum,
        file: expected,
      });
    }
  }
  // The other direction: a migration on disk that was never applied is `migrate status`'s job,
  // not this one's, so it is not reported here.

  console.log(
    `checksums: ${applied.length} applied migrations, ${files.size} migration.sql files`,
  );

  if (missingFile.length > 0) {
    console.error(
      '\nAPPLIED BUT NO FILE — the migration ran against this database and its file is gone:',
    );
    for (const name of missingFile) console.error(`  - ${name}`);
  }

  if (drifted.length > 0) {
    console.error(
      '\nCHECKSUM DRIFT — these files were edited after being applied, so the SQL that ran may',
    );
    console.error('not be the SQL that is written down:\n');
    for (const d of drifted) {
      console.error(`  - ${d.name}`);
      console.error(`      stored ${d.stored}`);
      console.error(`      file   ${d.file}`);
    }
    console.error(
      '\nFind out WHAT changed before doing anything: `git log -p -- packages/db/prisma/migrations/<name>/migration.sql`.',
    );
    console.error(
      '  comments only -> re-align the stored hash. SQL changed -> write a NEW migration; do NOT',
    );
    console.error(
      '  re-align, because that makes the difference permanent and invisible.',
    );
  }

  if (drifted.length > 0 || missingFile.length > 0) process.exit(1);
  console.log('checksums: every applied migration matches its file.');
} finally {
  await prisma.$disconnect();
}
