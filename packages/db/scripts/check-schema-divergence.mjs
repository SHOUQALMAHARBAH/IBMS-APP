#!/usr/bin/env node
/**
 * `schema.prisma` describes LESS than the database enforces — and every difference is named.
 *
 * ## Why a gate, and why this shape
 *
 * `scripts/verify.sh` and CI both carried a step called "migration history matches schema.prisma
 * (no drift)" whose command was `prisma migrate status`. That command compares the migration
 * history against the DATABASE; it never looks at `schema.prisma` at all. The step name promised
 * a check that did not exist — and the check it promised cannot exist in the obvious form
 * either, because this schema DELIBERATELY holds less than the migrations do: Prisma's schema
 * language cannot express a STORED generated column, a GIN index on an `Unsupported("tsvector")`
 * field, or a composite foreign key, all of which this database has. So "the diff is empty" is
 * not the property to assert, and asserting it would be red forever.
 *
 * The honest property is the house whole-set pattern (IMPROVEMENTS.md § 1.19): the diff is
 * EXACTLY this known set, every entry carrying the reason it is allowed to be there. A new
 * divergence fails. A divergence that DISAPPEARS also fails, so the table cannot rot into a list
 * of things that used to be true.
 *
 * ## What it caught the day it was written
 *
 * Six real divergences, none of them inexpressible, all found by running this comparison by hand
 * for the first time:
 *
 *  - `Insurer.insurerMaster` — the database has enforced `ON DELETE RESTRICT` since
 *    `20260929100000`, while an OPTIONAL Prisma relation defaults to `SetNull`. The diff wanted
 *    to drop the FK and recreate it as `SET NULL`: the next auto-generated migration would have
 *    quietly weakened a foreign key.
 *  - Five real indexes that existed in the database and nowhere in the schema, so the diff wanted
 *    to DROP them: `ScreeningMatch(listType, status)`, `ScreeningMatch(screeningRequestId)`,
 *    `ScreeningRequest(subjectFingerprint)`, `WatchlistSyncRun(status, completedAt DESC)`,
 *    `Insurer(canonicalName)`, and the GIN on `WatchlistEntry(canonicalTokens)`.
 *
 * All six were closed by DECLARING them — no migration, because the database already had exactly
 * those objects. That is the fix this gate exists to keep: a divergence is closed by making the
 * schema tell the truth, not by adding an entry below.
 *
 * ## Adding an entry
 *
 * Only for something Prisma genuinely cannot express. If it CAN be declared, declare it — an
 * entry here means every future `prisma migrate dev` in this repo generates that statement, and
 * someone eventually commits it.
 *
 * ## A BLIND SPOT, measured — this gate does NOT see PARTIAL indexes
 *
 * `migrate diff` does not report a partial index (`CREATE INDEX ... WHERE ...`) that exists in the
 * database and not in `schema.prisma`. Two of them are live and neither has ever appeared here:
 * `CommissionAgreement_one_open_per_insurer_line` (since 20260903120000) and
 * `CommissionAgreement_one_open_per_line_variant` (20261020100000) — both UNIQUE, both guarding
 * what the broker is paid, both invisible to this check.
 *
 * So a partial index can be dropped by a future migration and nothing here notices. Where one
 * carries a real invariant, assert it in its own migration's `DO` block (as
 * `20261020100000` does for `indnullsnotdistinct`) or in a test that reads `pg_index` — do not
 * rely on this gate for it. The same is true of CHECK constraints, which `migrate diff` also
 * leaves out.
 *
 * Compares the LIVE database rather than replaying the migrations, which needs no shadow database
 * and therefore no CREATEDB privilege in CI. The two were measured equivalent: replayed into a
 * shadow database, `--from-migrations` produced this identical set.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Prisma's CLI is invoked through `node` with the package's own entry point rather than through
// `npx`: `execFileSync` does not go through a shell, and on Windows `npx.cmd` needs one.
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Each key is a statement the diff is ALLOWED to contain; the value is why. */
const EXPECTED = {
  // ---- Composite foreign keys: (childId, organizationId) -> Parent(id, organizationId) ----
  // Expressible in Prisma in principle — the targets carry the `@@unique([id, organizationId])`
  // a composite reference needs — but declaring them would pull `organizationId` into the
  // relation and change the generated client's relation shape for models the whole codebase
  // reads. They are raw-SQL constraints on purpose: a child row that disagrees with its parent
  // about which office it belongs to FAILS TO INSERT.
  'ALTER TABLE "InsurerOfferedLine" DROP CONSTRAINT "InsurerOfferedLine_insurer_same_org_fkey";':
    'composite tenant FK, raw SQL by design',
  'ALTER TABLE "InsurerOfferedLine" DROP CONSTRAINT "InsurerOfferedLine_office_line_same_org_fkey";':
    'composite tenant FK, raw SQL by design',
  'ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_role_organization_agree_fkey";':
    'composite tenant FK — the structural answer to grant drift, see the RBAC Phase 1 migration',

  // The four MUST models' office-line FKs (`20261019100000`). Same shape, same reason: without the
  // composite, office A's Policy could reference office B's private line and the reference would
  // be structurally valid.
  'ALTER TABLE "InsuranceProgramLine" DROP CONSTRAINT "InsuranceProgramLine_office_line_same_org_fkey";':
    'composite tenant FK, raw SQL by design',
  'ALTER TABLE "RFQ" DROP CONSTRAINT "RFQ_office_line_same_org_fkey";':
    'composite tenant FK, raw SQL by design',
  'ALTER TABLE "Policy" DROP CONSTRAINT "Policy_office_line_same_org_fkey";':
    'composite tenant FK, raw SQL by design',
  'ALTER TABLE "CommissionAgreement" DROP CONSTRAINT "CommissionAgreement_office_line_same_org_fkey";':
    'composite tenant FK, raw SQL by design',

  // ---- GIN indexes on `Unsupported("tsvector")` ----
  // Prisma cannot index a field whose type it does not model. `canonicalTokens` is a plain
  // `String[]`, which it CAN index — so that one was declared rather than listed here.
  'DROP INDEX "Customer_searchVector_idx";': 'GIN on Unsupported("tsvector")',
  'DROP INDEX "Prospect_searchVector_idx";': 'GIN on Unsupported("tsvector")',
  'DROP INDEX "Vendor_searchVector_idx";': 'GIN on Unsupported("tsvector")',

  // ---- STORED generated columns: no Prisma syntax exists at all ----
  // Prisma models them as ordinary nullable columns, so the diff proposes removing the generation
  // expression. Accepting that would make these columns application-written, which is the exact
  // defect `20261013100000` removed for the canonical key.
  'ALTER TABLE "Customer" ALTER COLUMN "searchVector" DROP DEFAULT;': 'STORED generated column',
  'ALTER TABLE "Prospect" ALTER COLUMN "searchVector" DROP DEFAULT;': 'STORED generated column',
  'ALTER TABLE "Vendor" ALTER COLUMN "searchVector" DROP DEFAULT;': 'STORED generated column',
  'ALTER TABLE "WatchlistEntry" ALTER COLUMN "canonicalTokens" DROP DEFAULT;':
    'STORED generated column',
  'ALTER TABLE "Insurer" ALTER COLUMN "canonicalName" DROP DEFAULT;':
    'STORED generated column over canonical_name_key() — the point is that the application CANNOT write it',
  'ALTER TABLE "CommissionAgreement" ALTER COLUMN "variantKey" DROP DEFAULT;':
    'STORED generated column over canonical_name_key() — the commission variant matching key, which the application must not be able to write',

  // ---- Identifier truncation ----
  // Postgres and Prisma truncate a >63-character index name at different points. Cosmetic, and
  // renaming it in the database would only move the difference.
  'ALTER INDEX "ScreeningMatch_kycRecordId_watchlistEntryId_subjectCanonical_ke" RENAME TO "ScreeningMatch_kycRecordId_watchlistEntryId_subjectCanonica_key";':
    '63-char identifier truncation differs between Postgres and Prisma',
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const script = execFileSync(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'diff',
    '--from-url',
    url,
    '--to-schema-datamodel',
    './prisma/schema.prisma',
    '--script',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
);

const actual = script
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^(ALTER|DROP|CREATE|UPDATE|INSERT)\b/.test(line));

const expected = Object.keys(EXPECTED);
const unexpected = actual.filter((s) => !(s in EXPECTED));
const gone = expected.filter((s) => !actual.includes(s));

console.log(
  `schema divergence: ${actual.length} statements, ${expected.length} expected and named`,
);

if (unexpected.length > 0) {
  console.error(
    '\nNEW DIVERGENCE — the database and schema.prisma disagree about something nobody has named:\n',
  );
  for (const s of unexpected) console.error(`  ${s}`);
  console.error(
    '\nThis is the direction that bites: the statement above is what the next `prisma migrate dev`',
  );
  console.error(
    'will generate, so if it drops an index or weakens a constraint, that is what gets committed.',
  );
  console.error(
    'Fix it by making schema.prisma tell the truth — declare the index, declare the `onDelete`.',
  );
  console.error(
    'Six divergences were closed that way. Add an EXPECTED entry only if Prisma genuinely cannot',
  );
  console.error('express the object, and say why.');
}

if (gone.length > 0) {
  console.error(
    '\nEXPECTED BUT ABSENT — these no longer diverge, so their entries are stale and must be',
  );
  console.error(
    'removed. A known-set gate that keeps retired entries stops being a measurement:\n',
  );
  for (const s of gone) console.error(`  ${s}\n      was allowed because: ${EXPECTED[s]}`);
}

if (unexpected.length > 0 || gone.length > 0) process.exit(1);
console.log('schema divergence: exactly the named set, every entry justified.');
