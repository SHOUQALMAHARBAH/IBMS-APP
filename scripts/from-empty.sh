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
# It does not touch the dev or db-test DATABASES. It creates a throwaway database on the db-test
# CONTAINER, uses it, and drops it — in a trap, so an interrupted run does not leave it behind to
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

CONTAINER=ibms-app-db-test-1
SCRATCH="ibms_fromempty_$$"
ADMIN_URL="postgresql://ibms:ibms@localhost:5434/ibms_test?schema=public"
SCRATCH_URL="postgresql://ibms:ibms@localhost:5434/${SCRATCH}?schema=public"

say() { printf '\n== %s\n' "$*"; }
psql_scratch() { docker exec -i "$CONTAINER" psql -U ibms -d "$SCRATCH" -tA -c "$1"; }

cleanup() {
  docker exec -i "$CONTAINER" psql -U ibms -d ibms_test -c \
    "DROP DATABASE IF EXISTS \"${SCRATCH}\" WITH (FORCE)" >/dev/null 2>&1
}
trap cleanup EXIT

# SKIPS RATHER THAN FAILS WITHOUT DOCKER, and the distinction is load-bearing. This gate needs the
# db-test container; a machine without it is not a tree with a defect, and a gate that goes red for an
# environmental reason is one everybody learns to ignore — which is how a real failure gets dismissed
# later. Same shape as `check-ci.sh`, which passes quietly when HEAD is unpushed.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "from-empty: SKIPPED — the ${CONTAINER} container is not running."
  echo "from-empty: this is a skip, NOT a pass. Run \`docker compose up -d db-test\` and re-run"
  echo "from-empty: before claiming every migration applies from nothing."
  trap - EXIT
  exit 0
fi

say "creating the throwaway database ${SCRATCH}"
docker exec -i "$CONTAINER" psql -U ibms -d ibms_test -c "CREATE DATABASE \"${SCRATCH}\"" \
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
docker exec -i "$CONTAINER" psql -U ibms -d "$SCRATCH" -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ibms_app') THEN CREATE ROLE ibms_app LOGIN PASSWORD 'ibms_app'; END IF; END \$\$;" >/dev/null

say "applying every migration from nothing"
DATABASE_URL="$SCRATCH_URL" npx prisma migrate deploy --schema packages/db/prisma/schema.prisma \
  || { echo "FROM-EMPTY: migrate deploy FAILED on an empty database"; exit 1; }

ON_DISK=$(ls packages/db/prisma/migrations | grep -c '^2026')
APPLIED=$(psql_scratch "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
say "migrations: ${APPLIED} applied / ${ON_DISK} on disk"
[ "$APPLIED" = "$ON_DISK" ] || { echo "FROM-EMPTY: applied count does not match the files"; exit 1; }

say "seeding"
DATABASE_URL="$SCRATCH_URL" NODE_ENV=development npx tsx packages/db/prisma/seed.ts \
  || { echo "FROM-EMPTY: the SEED failed on a freshly migrated database"; exit 1; }

# ---------------------------------------------------------------------------
# The structural facts this module put in, asserted on a database built from
# nothing rather than on one that grew into the right shape.
# ---------------------------------------------------------------------------
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '  ok    %-56s %s\n' "$1" "$3"
  else printf '  FAIL  %-56s expected %s, got %s\n' "$1" "$2" "$3"; fail=1; fi
}

say "asserting the structure"
check "permission codes seeded" 227 \
  "$(psql_scratch 'SELECT count(*) FROM "Permission"')"
check "PLATFORM-scoped codes" 5 \
  "$(psql_scratch $'SELECT count(*) FROM "Permission" WHERE scope = \'PLATFORM\'')"
check "exactly one PROVIDER organization" 1 \
  "$(psql_scratch $'SELECT count(*) FROM "Organization" WHERE type = \'PROVIDER\'')"
check "the provider role's grants" 11 \
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
check "composite tenant FKs" 13 \
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
