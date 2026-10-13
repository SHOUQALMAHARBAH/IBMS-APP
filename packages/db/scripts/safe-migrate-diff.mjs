#!/usr/bin/env node
/**
 * `prisma migrate diff` with the one guard that stops it destroying a real database.
 *
 * ## WHY THIS FILE EXISTS
 *
 * On 2026-10-13 the dev database was wiped by a hand-run `prisma migrate diff
 * --shadow-database-url <url>` where the url had been DERIVED from `DATABASE_URL` by substitution:
 *
 *     echo 'postgresql://ibms:pw@localhost:5433/ibms?schema=public&connection_limit=5' \
 *       | sed 's#/[^/?]*$#/ibms_shadow_d#'
 *     -> postgresql://ibms:pw@localhost:5433/ibms?schema=public&connection_limit=5   (UNCHANGED)
 *
 * `[^/?]*$` cannot match across the `?`, so the substitution matched nothing and returned its input.
 * `--shadow-database-url` then received the DEV url, and resetting the shadow database is that
 * flag's documented purpose. Migration history and data gone.
 *
 * It is the repository's own fifth standing rule — a command correct only because today's input
 * happens to suit it — failing on the person who had written it down hours earlier. That sed works
 * on a url with no query string, and every url in this repository has one.
 *
 * ## THE FIX IS NOT CARE, IT IS TWO RULES
 *
 * 1. A SHADOW DATABASE GETS ITS OWN NAMED VARIABLE, SUPPLIED AND NEVER COMPUTED. A substitution
 *    that silently matches nothing returns the input unchanged — and the input was the thing being
 *    destroyed. `SHADOW_DATABASE_URL` is read, never derived.
 *
 * 2. THE ARGUMENT IS CHECKED BEFORE THE DESTRUCTIVE FLAG IS USED, not after. `--shadow-database-url`
 *    RESETS whatever it points at, so an equality check against the known real databases has to run
 *    first. That check is what would have stopped this exactly.
 *
 * ## WHAT THIS IS FOR, AND WHAT IT IS NOT
 *
 * It is for CHECKING a hand-written migration against what Prisma would generate. Its output is
 * never applied: `schema.prisma` deliberately holds LESS than the database, so a generated
 * migration drops the thirteen composite tenant foreign keys Prisma cannot express — which is the
 * reason every migration here is hand-written in the first place.
 *
 * Usage:  SHADOW_DATABASE_URL=postgresql://…/ibms_shadow node scripts/safe-migrate-diff.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Normalised for COMPARISON only — never to build a url. Query parameters and a trailing slash do
 *  not change which database a url points at, and a guard fooled by `?connection_limit=5` is no
 *  guard at all. */
function databaseIdentity(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    // An unparseable url is not something to guess about.
    return null;
  }
}

const shadow = process.env.SHADOW_DATABASE_URL;
if (!shadow) {
  console.error(
    'SHADOW_DATABASE_URL is not set.\n\n' +
      'It is supplied, never computed from DATABASE_URL. The one time it was computed, the\n' +
      'substitution silently matched nothing, returned the dev url unchanged, and `migrate diff`\n' +
      'reset the dev database — which is what that flag does to whatever it points at.\n\n' +
      'Create a throwaway database and name it explicitly:\n' +
      '  SHADOW_DATABASE_URL=postgresql://ibms:…@localhost:5433/ibms_shadow node scripts/safe-migrate-diff.mjs',
  );
  process.exit(1);
}

const shadowId = databaseIdentity(shadow);
if (!shadowId) {
  console.error(`SHADOW_DATABASE_URL is not a parseable URL: ${shadow}`);
  process.exit(1);
}

/*
 * EVERY real database this repository knows about. Checked BEFORE the flag is used, because after
 * is too late by definition — the reset has already happened.
 *
 * `DATABASE_URL` covers whichever of dev or test the caller has loaded; `TEST_DATABASE_URL` is
 * checked too, so running this with `.env` loaded still cannot target db-test.
 */
const PROTECTED = [
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['TEST_DATABASE_URL', process.env.TEST_DATABASE_URL],
];

for (const [name, url] of PROTECTED) {
  if (!url) continue;
  if (databaseIdentity(url) === shadowId) {
    console.error(
      `REFUSED: SHADOW_DATABASE_URL points at the same database as ${name}.\n\n` +
        `  shadow: ${shadow.replace(/:[^:@]*@/, ':***@')}\n` +
        `  ${name}: ${url.replace(/:[^:@]*@/, ':***@')}\n\n` +
        '`prisma migrate diff --shadow-database-url` RESETS the database it points at. Running this\n' +
        'would destroy the data and migration history of a real database. That is not a warning\n' +
        'about what might happen — it is what happened on 2026-10-13, and this check is the repair.',
    );
    process.exit(1);
  }
}

const prismaCli = require.resolve('prisma/build/index.js');
const out = execFileSync(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'diff',
    '--from-migrations',
    './prisma/migrations',
    '--to-schema-datamodel',
    './prisma/schema.prisma',
    '--shadow-database-url',
    shadow,
    '--script',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);

process.stdout.write(out);

/*
 * The reminder goes to STDERR so it cannot be mistaken for part of the SQL if the output is piped
 * into a file — which is precisely what somebody about to make this mistake would do.
 */
const drops = out
  .split('\n')
  .filter((l) => /^ALTER TABLE .* DROP CONSTRAINT .*_same_org_fkey/.test(l.trim()));
if (drops.length > 0) {
  console.error(
    `\n${drops.length} of the statements above DROP a composite tenant foreign key.\n` +
      'Those are the constraints Prisma cannot express, so a diff reads them as drift. Applying this\n' +
      'output would let one office\'s row reference another office\'s line, with every test green.\n' +
      'Take the ADDITIVE statements only and hand-write the migration.',
  );
}
