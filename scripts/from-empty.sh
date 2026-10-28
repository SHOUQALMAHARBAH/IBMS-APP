#!/usr/bin/env bash
#
# FROM-EMPTY CHECK — every migration from nothing, then the seed, then drop.
#
# ## Why this exists as a script rather than as a routine somebody remembers
#
# `CLAUDE.md` has recorded "run the from-empty check" as the rule for any migration that reads
# existing rows, and it has been done by hand each time. A hand routine is one that gets skipped
# under time pressure, and the thing it catches cannot be caught any other way: both local databases
# are already populated, so a migration that only works on a database that already has rows —
# a backfill that compares against what it FOUND rather than what it was OWED, an assertion that
# needs a row to exist before it can fire — passes on dev and on db-test and fails on a deploy.
#
# It is also what proves the SEED still works from nothing. The seed's create path and its update
# path are different code, and an upsert against rows a migration already created exercises only the
# second — which is exactly how a broken seed once reached CI looking locally green.
#
# ## What it does NOT do
#
# It does not touch the dev or db-test DATABASES. It creates a throwaway database on whichever
# SERVER `FROM_EMPTY_ADMIN_URL` names (the local db-test service by default, CI's postgres service
# when CI sets it), uses it, and drops it — in a trap, so an interrupted run does not leave it behind to
# confuse the next one. It never runs `prisma migrate reset`, which refuses to run unattended and
# needs the user's explicit consent for that run.
#
# The one thing that outlives the run is the `ibms_app` ROLE, and only on a cluster where it does not
# already exist — see the note at the CREATE ROLE below. "Does not touch db-test" is therefore a claim
# about its DATABASE, not about its cluster, and is worded that way on purpose.
#
# Usage:  bash scripts/from-empty.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCRATCH="ibms_fromempty_$$"

# WHERE THE SERVER IS, resolved rather than hard-coded. The local db-test compose service publishes
# 5434; CI's postgres SERVICE container answers on 5432 and has no container name to `docker exec`
# into. `FROM_EMPTY_ADMIN_URL` lets CI say so without this script knowing anything about CI.
ADMIN_URL="${FROM_EMPTY_ADMIN_URL:-postgresql://ibms:ibms@localhost:5434/ibms_test?schema=public}"
SCRATCH_URL="${ADMIN_URL%%/ibms_test*}/${SCRATCH}?schema=public"

say() { printf '\n== %s\n' "$*"; }

# ACCESS GOES THROUGH PRISMA, NOT psql — measured: `psql` is on PATH on neither the development
# machine (which is why this script used `docker exec`) nor in any CI step, while `PrismaClient`
# plus a URL is what CI's three existing database gates already use. `scratch-sql.mjs` reproduces
# `psql -tA`'s output shape exactly, because nineteen assertions below compare against it.
sql() { node packages/db/scripts/scratch-sql.mjs "$1" "$2"; }
psql_scratch() { sql "$SCRATCH_URL" "$1"; }
psql_admin() { sql "$ADMIN_URL" "$1"; }

cleanup() {
  sql "$ADMIN_URL" "DROP DATABASE IF EXISTS \"${SCRATCH}\" WITH (FORCE)" >/dev/null 2>&1
}
trap cleanup EXIT

# SKIPS ON A LAPTOP, REFUSES IN CI — and both halves are load-bearing.
#
# On a development machine a missing database server is not a tree with a defect, and a gate that
# goes red for an environmental reason is one everybody learns to ignore, which is how a real failure
# gets dismissed later. Same shape as `check-ci.sh`, which passes quietly when HEAD is unpushed.
#
# IN CI THAT REASONING INVERTS, and this is the half that was missing. The server is a guaranteed
# service container, so an unreachable one is a real failure — and dropping this script into a CI step
# while it could still skip would have produced a green step printing "SKIPPED" on every run forever:
# a gate that never runs, which is exactly the defect that CI step was added to fix.
#
# The skip above is right on a laptop and a LIE in CI. Dropping this script into a CI step while it
# could still skip would have produced a green step printing "SKIPPED" on every run forever: a gate
# that never runs, which is exactly the defect that CI step was added to fix. In CI the server is a
# guaranteed service container, so an unreachable one is a real failure.
if ! psql_admin 'SELECT 1' >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "FROM-EMPTY: the database server at ADMIN_URL is unreachable, and this is CI."
    echo "FROM-EMPTY: a skip here would be a green step that never runs the gate — the defect this"
    echo "FROM-EMPTY: step exists to fix. Check the postgres service and FROM_EMPTY_ADMIN_URL."
    exit 1
  fi
  echo "from-empty: SKIPPED — no reachable database server at ADMIN_URL."
  echo "from-empty: this is a skip, NOT a pass. Run \`docker compose up -d db-test\` and re-run"
  echo "from-empty: before claiming every migration applies from nothing."
  trap - EXIT
  exit 0
fi

say "creating the throwaway database ${SCRATCH}"
psql_admin "CREATE DATABASE \"${SCRATCH}\"" \
  || { echo "FROM-EMPTY: could not create the throwaway database"; exit 1; }

# `ibms_app` is the runtime role the privileges gate checks; the migrations grant to it by name, so
# it has to exist or the GRANT statements fail on a database built from nothing.
#
# THE ONE CLUSTER-LEVEL EFFECT, STATED BECAUSE THE TRAP CANNOT UNDO IT. `CREATE ROLE` is cluster-wide,
# not per-database, so this is the only thing here that outlives the throwaway database. Measured on
# this machine: the role already exists on the db-test cluster (`rolcanlogin = t`), so the guard is a
# no-op and nothing is created. On a cluster where it is genuinely absent it IS created and is left in
# place deliberately — dropping a role every migration grants to would break the next run, and a
# cleanup that breaks what it cleans up after is worse than the residue.
# Two plain statements instead of a `DO $$ … $$` block, deliberately: dollar-quoting would have to
# survive bash, a shell argument and whatever the Prisma client does with `$`-prefixed tokens, and
# betting on all three for a two-line conditional is a bet with no upside. A count and an `if` say
# the same thing and cannot be mangled.
if [ "$(psql_scratch "SELECT count(*) FROM pg_roles WHERE rolname = 'ibms_app'")" = "0" ]; then
  psql_scratch "CREATE ROLE ibms_app LOGIN PASSWORD 'ibms_app'" >/dev/null
fi

say "applying every migration from nothing"
DATABASE_URL="$SCRATCH_URL" npx prisma migrate deploy --schema packages/db/prisma/schema.prisma \
  || { echo "FROM-EMPTY: migrate deploy FAILED on an empty database"; exit 1; }

ON_DISK=$(ls packages/db/prisma/migrations | grep -c '^2026')
APPLIED=$(psql_scratch "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
say "migrations: ${APPLIED} applied / ${ON_DISK} on disk"
[ "$APPLIED" = "$ON_DISK" ] || { echo "FROM-EMPTY: applied count does not match the files"; exit 1; }

say "seeding"
# TEE'D, because one assertion below is DERIVED from what the seed itself announces rather than
# from a literal. The output still reaches the terminal unchanged.
SEED_LOG="$(mktemp)"
DATABASE_URL="$SCRATCH_URL" NODE_ENV=development npx tsx packages/db/prisma/seed.ts 2>&1 \
  | tee "$SEED_LOG" \
  || { echo "FROM-EMPTY: the SEED failed on a freshly migrated database"; exit 1; }
# `pipefail` is not assumed: with a pipe the `||` above sees tee's status, so the seed's own exit is
# checked separately through PIPESTATUS.
[ "${PIPESTATUS[0]:-0}" = "0" ] \
  || { echo "FROM-EMPTY: the SEED failed on a freshly migrated database"; exit 1; }

# THE PROVIDER'S GRANT COUNT, DERIVED FROM THE SEED'S OWN ANNOUNCEMENT.
#
# This assertion used to be a literal 11. `PROVIDER_CODES` went 11 -> 13 with the authorised
# email-integration widening, the pin never moved, and this check has been FAILING since — reported
# as green in that batch's own row, which was false. Nothing was red because this script is gated by
# `verify.sh` and by no CI step: the same way `combined-duty-projection.py` sat dead on a literal.
#
# Bumping the number would restore the script and keep the defect. So the expected figure is read
# from the line the seed already prints — `(13 permissions: …)` — and the database is asserted to
# AGREE WITH WHAT THE SEED SAID IT DID. A fourteenth provider code moves both sides together.
PROVIDER_GRANTS_ANNOUNCED="$(sed -n 's/.*PLATFORM_OPERATOR role (\([0-9]\{1,\}\) permissions:.*/\1/p' "$SEED_LOG" | head -1)"
if [ -z "$PROVIDER_GRANTS_ANNOUNCED" ]; then
  echo "FROM-EMPTY: could not read the provider role's grant count out of the seed's own output."
  echo "  The seed's wording changed, or it stopped printing that line. Do NOT replace this with a"
  echo "  literal — that is the defect this derivation replaced. Re-point the pattern at the new line."
  exit 1
fi

# ---------------------------------------------------------------------------
# The structural facts this module put in, asserted on a database built from
# nothing rather than on one that grew into the right shape.
# ---------------------------------------------------------------------------
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '  ok    %-56s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-56s expected %s, got %s\n' "$1" "$2" "$3"
    # THE FIGURE MOVED, AND MOVING THE PIN IS A RECORDED DECISION — NOT A NUMBER TO BUMP.
    #
    # Eight of these assertions are pinned to figures that grow with ordinary work, and that is
    # deliberate: `PROVIDER_CODES` pinned at thirteen so a fourteenth fails until somebody records
    # it is the same instrument. The message used to read "expected 227, got 228", which invites
    # exactly the edit it exists to prevent, so it now says what a mismatch MEANS.
    printf '        ^ the figure MOVED. If that was a decision, come to scripts/from-empty.sh and\n'
    printf '          move the pin WITH THE REASON beside it. If it was not, something changed the\n'
    printf '          shape a database reaches from nothing and the pin is the only thing that saw it.\n'
    fail=1
  fi
}

say "asserting the structure"
# 227 -> 228, batch 5 group 7b: ONE code minted, `retention.extend`, granted to the template default
# the owner measured (COMPLIANCE_OFFICER and DATA_PROTECTION_OFFICER — the pair that already holds
# both retention-period codes). Moved here deliberately rather than derived, because a catalogue that
# grows without anybody recording it is how a capability arrives unnoticed.
#
# 228 -> 229, batch 5 group 7c: ONE more, `retention.archive.retrieve`, to the same pair — measured
# rather than preferred, and the argument is that the two retrieval bases map to the two roles: a CBJ
# audit is Compliance's domain (`license.manage` and `internal-audit.record` are COMPLIANCE alone)
# and a judicial request is the DPO's (`legal-hold.manage` is DPO alone). The owner reserved this
# grant set as her own decision when the code was deferred out of 7b; this is the measured template
# awaiting it, and changing it costs one seed line plus a revoking migration.
#
# 229 -> 230, module 0-ب decision 36: ONE code minted, `conflict-of-interest.register.read`, to
# BRANCH_DEPARTMENT_MANAGER — the manager role in this product, since MEASURED against the seeded
# grid there is no role named OFFICE_MANAGER. It is a TEMPLATE DEFAULT and not a lock (decision 80).
# Nothing was minted for DECLARING a conflict: the discloser is the subject, so no permission exists
# for it or can, which is why this moves by one rather than two.
check "permission codes seeded" 230 \
  "$(psql_scratch 'SELECT count(*) FROM "Permission"')"
check "PLATFORM-scoped codes" 5 \
  "$(psql_scratch $'SELECT count(*) FROM "Permission" WHERE scope = \'PLATFORM\'')"
check "exactly one PROVIDER organization" 1 \
  "$(psql_scratch $'SELECT count(*) FROM "Organization" WHERE type = \'PROVIDER\'')"
check "the provider role's grants (derived from the seed's own output)" "$PROVIDER_GRANTS_ANNOUNCED" \
  "$(psql_scratch 'SELECT count(*) FROM "RolePermission" rp JOIN "Organization" o ON o.id = rp."organizationId" WHERE o.type = '"'"'PROVIDER'"'"'')"
check "registration-pack columns are NULLABLE" 0 \
  "$(psql_scratch 'SELECT count(*) FROM pg_attribute WHERE attrelid = '"'"'"Organization"'"'"'::regclass AND attnotnull AND attname IN ('"'"'premisesTenureDocumentId'"'"','"'"'associationMembershipDocumentId'"'"')')"
check "NO completeness column on Organization" 0 \
  "$(psql_scratch 'SELECT count(*) FROM pg_attribute WHERE attrelid = '"'"'"Organization"'"'"'::regclass AND attnum > 0 AND NOT attisdropped AND (attname ILIKE '"'"'%complete%'"'"' OR attname ILIKE '"'"'%registrationpack%'"'"')')"
# `psql -tA` renders a boolean as `true`, not `t`. The first version of this line expected `t|t` and
# failed on a database that was entirely correct — a gate that goes red on a clean tree is the one
# way it loses its reader, so it is recorded here rather than quietly amended.
check "RegulatoryAction RLS is ENABLEd and FORCEd" "true|true" \
  "$(psql_scratch 'SELECT relrowsecurity || '"'"'|'"'"' || relforcerowsecurity FROM pg_class WHERE oid = '"'"'"RegulatoryAction"'"'"'::regclass')"
check "the one-provider partial unique still carries its WHERE" 1 \
  "$(psql_scratch 'SELECT count(*) FROM pg_indexes WHERE indexname = '"'"'Organization_one_provider'"'"' AND indexdef ILIKE '"'"'%WHERE%'"'"'')"
# 13 -> 14, batch 5 group 7b: `RetentionExtension_legalHold_same_org_fkey`, so an extension cannot
# cite a legal hold belonging to a different office — which would make the retention of one office
# depend on a fact it cannot see. Prisma cannot express the pair, so it is also a named entry in the
# divergence gate's expected set.
#
# 14 -> 15, owner decision 56: `IncidentContainmentAction_incident_same_org_fkey`, so a containment
# action cannot be filed against another office's incident — which would put one office's breach
# response inside another office's register, on a record a regulator reads. Same shape and same
# reason as the entry above, and Prisma cannot express it either, so it is a named entry in the
# divergence gate's expected set too.
#
# AND THIS PIN IS WHY THE FIGURE IS HERE AT ALL: it fired in CI on the commit that added the FK,
# because I ran the six database gates and NOT this script. `db:divergence` sees the FK as a
# DECLARED expected statement and says nothing about the count; only this pin notices that the
# shape a database reaches from NOTHING has moved.
check "composite tenant FKs" 15 \
  "$(psql_scratch $'SELECT count(*) FROM pg_constraint WHERE contype = \'f\' AND conname LIKE \'%\\_same\\_org\\_fkey\'')"
check "the eight reference tables are seeded" 8 \
  "$(psql_scratch 'SELECT count(*) FROM (SELECT 1 FROM "LegalForm" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "LicensingAuthority" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "Country" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "City" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "Bank" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "Currency" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "BusinessModel" HAVING count(*) > 0 UNION ALL SELECT 1 FROM "RatingAgency" HAVING count(*) > 0) t')"
check "insurance lines" 32 \
  "$(psql_scratch 'SELECT count(*) FROM "InsuranceLine"')"

# BATCH 1 ITEM 1 HALF B — EVERY ORGANIZATION HAS A DEFAULT BRANCH AND DEPARTMENT.
#
# This is the assertion the defect needed. The code was built and WIRED and the data was still
# missing, because the default office's `ensureDefaultOrgUnits` call sat inside a function that
# returns EARLY when the organization already exists — unreachable on any database that had ever
# been seeded, and nothing failed. A call in an unreachable place is what a count assertion catches
# and a reading does not.
#
# Expressed as "organizations with NO branch" = 0 rather than as a total, so it stays true when a
# fourth organization is seeded. The provisioning form makes both mandatory, so an organization with
# neither cannot provision its first user at all — which is the failure this closes.
check "every organization has a default branch" 0 \
  "$(psql_scratch 'SELECT count(*) FROM "Organization" o WHERE NOT EXISTS (SELECT 1 FROM "Branch" b WHERE b."organizationId" = o.id)')"
check "every organization has a default department" 0 \
  "$(psql_scratch 'SELECT count(*) FROM "Organization" o WHERE NOT EXISTS (SELECT 1 FROM "Department" d WHERE d."organizationId" = o.id)')"

# BATCH 1 ITEM 4 — the provider's own name, owner's ruling of 19 October. Both capital Gs.
# Pinned because it is the organization's identity AND because the seed now UPSERTS it: a
# create-only literal named it correctly on a database built from nothing and left every existing
# database reading the old name forever.
check "the provider English name" "GO Global" \
  "$(psql_scratch $'SELECT "legalName" FROM "Organization" WHERE type = \'PROVIDER\'')"
check "the provider Arabic name" "جو جلوبال" \
  "$(psql_scratch $'SELECT "legalNameAr" FROM "Organization" WHERE type = \'PROVIDER\'')"
# THE SIXTEENTH MAKER/CHECKER PAIR (module 0 close, decision 3). Pinned here because a pair is a
# DATABASE fact: the registry, the readiness signal and the schema guard all derive from it, and a
# migration that silently failed to add the constraint would leave two split codes enforcing
# nothing — separation in appearance only.
check "maker/checker CHECK constraints" 16 \
  "$(psql_scratch "SELECT count(*) FROM pg_constraint WHERE conname LIKE '%maker%checker%'")"
check "zero RegulatoryAction rows — no migration invents a regulator's act" 0 \
  "$(psql_scratch 'SELECT count(*) FROM "RegulatoryAction"')"

# THE ELEVEN ENUM DESCRIPTIONS (module 0-ب close, the owner's decision of 2026-10-15 — a description
# TABLE beside each enum rather than i18n keys, because "keys nothing renders is the shape the
# enforcement inventory exists to reject"). Pinned here because the migration INSERTs them and the
# seed upserts them: entry 33 established that data arriving only through the seed never reaches a
# database nobody reseeds, so a from-empty run is the only place both halves are observed together.
# A count, not a set — the SET is pinned against the GENERATED Prisma enums by
# `enum-descriptions.spec.ts`, which is the only place that can see a member added without a line.
check "enum member descriptions across the four new enums" 11 \
  "$(psql_scratch 'SELECT (SELECT count(*) FROM "BrokerageKindDescription") + (SELECT count(*) FROM "RegulatoryActionKindDescription") + (SELECT count(*) FROM "RegulatoryActionBasisDescription") + (SELECT count(*) FROM "IntegrationMethodDescription")')"
# EIGHT, not two. `descriptionAr` was required on `LegalForm` and `BusinessModel` alone until the
# owner reversed that: where a value carries NO consequence the description must SAY so, because a
# person who believes his choice changes the system's behaviour and later finds it does not stops
# trusting every list after it. Each of the eight lists now carries its own CHECK, and a migration
# that silently dropped one would leave a list able to take an undescribed row through a screen.
check "every reference list requires an Arabic description" 8 \
  "$(psql_scratch "SELECT count(*) FROM pg_constraint WHERE conname LIKE '%_description_required'")"

# MODULE 0-ب, THE CATEGORIES BATCH — the shipped retention template. Decisions 32 and 33.
#
# Four assertions, and three of them are ZEROES on purpose: a zero survives a fourth office and a
# fourth template category, where a total goes stale the next time the template grows. The
# branch/department assertions above are phrased the same way and for the same reason.
check "brokerage offices with NO retention template at all" 0 \
  "$(psql_scratch "SELECT count(*) FROM \"Organization\" o WHERE o.\"type\" = 'BROKERAGE_OFFICE' AND NOT EXISTS (SELECT 1 FROM \"RetentionScheduleItem\" r WHERE r.\"organizationId\" = o.\"id\")")"

# THE DECISION ITSELF, as a zero in BOTH directions. A category governed by one of the two statutory
# floors must ship with NO period — a period beside an article number reads as a legal opinion we do
# not have — and a category with no floor must ship WITH one, or it would ship inert and never alert.
#
# The floor names are written out rather than read from the api config, which SQL cannot import. They
# are pinned against the config by `retention-template.config.spec.ts`, so a change to either side
# has two places to fail.
check "floored template categories shipped WITH a period (must be none)" 0 \
  "$(psql_scratch "SELECT count(*) FROM \"RetentionScheduleItem\" WHERE \"recordCategory\" IN ('KYCRecord','CustomerFile','Receipt','Remittance','CommissionLedgerEntry','Settlement','Invoice') AND \"retentionPeriodMonths\" IS NOT NULL")"
check "unfloored template categories shipped WITHOUT a period (must be none)" 0 \
  "$(psql_scratch "SELECT count(*) FROM \"RetentionScheduleItem\" WHERE \"recordCategory\" = 'Quotation' AND \"retentionPeriodMonths\" IS NULL")"

# And the quote category's own figure, which is the owner's default rather than a minimum. Pinned
# because it is the FIRST default this product ships and moving it is a decision about how long an
# office keeps a quote the customer refused.
check "the quote category ships at ONE month per office" 1 \
  "$(psql_scratch "SELECT DISTINCT \"retentionPeriodMonths\" FROM \"RetentionScheduleItem\" WHERE \"recordCategory\" = 'Quotation'")"

# NOTHING IS CONFIRMED BY A SEED. Every shipped row is a draft until a lawyer signs it off, so the
# template must reach a from-nothing database with zero confirmations — which is also what makes
# every row INERT on a fresh office: nothing measured, nothing proposed. A seed that confirmed its
# own periods would authorise destruction on figures nobody read.
check "retention periods a SEED confirmed (must be none)" 0 \
  "$(psql_scratch "SELECT count(*) FROM \"RetentionScheduleItem\" WHERE \"confirmedByLegalCounselAt\" IS NOT NULL")"

# AND THE PROVIDER VIEW'S ONE NEW FACT — register entry 97, closed. The column list IS the
# cross-office privacy boundary, so the assertion is that it carries the fact AND nothing behind it.
check "the provider view carries mayNotIssue" 1 \
  "$(psql_scratch "SELECT count(*) FROM information_schema.columns WHERE table_name = 'ProviderOfficeState' AND column_name = 'mayNotIssue'")"
check "regulatory DETAIL leaked into the provider view (must be none)" 0 \
  "$(psql_scratch "SELECT count(*) FROM information_schema.columns WHERE table_name = 'ProviderOfficeState' AND column_name IN ('decisionRef','basis','effectiveFrom','suspendedUntil','documentId','kind','standingActDecisionRef','licenseStatus')")"

if [ "$fail" != "0" ]; then
  echo
  echo "FROM-EMPTY: FAILED — the shape a database reaches from nothing is not the shape of dev."
  exit 1
fi

# ---------------------------------------------------------------------------------------------
# REPORTED, NOT CHECKED — the two figures `docs/first-run.md` quotes to the owner.
#
# They are MEASUREMENTS and not `check` rows on purpose. Both grow whenever a permission or a grant
# is added, so pinning them here would turn every ordinary catalogue change into a red gate, and
# pinning them in a DOCUMENT is how `first-run.md` came to tell the owner to expect 219 permissions
# and 502 grants when the real figures had moved — which, followed literally, has her re-run a seed
# that succeeded and conclude something is broken. That is the exact defect class this module's close
# was spent on, in the document she reads first.
#
# What IS pinned is the permission count, one `check` above, which is a different job: that assertion
# is about a database built from nothing matching dev, and it is maintained by whoever changes the
# catalogue. These two lines exist so the figures in the document can be re-measured rather than
# remembered.
say "MEASURED for first-run.md — permissions: $(psql_scratch 'SELECT count(*) FROM "Permission"')"
say "MEASURED for first-run.md — role-permission grants: $(psql_scratch 'SELECT count(*) FROM "RolePermission"')"
say "MEASURED for first-run.md — roles: $(psql_scratch 'SELECT count(*) FROM "Role"')"

say "FROM-EMPTY: ${APPLIED} migrations from nothing, then the seed, every assertion green"
