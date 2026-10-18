#!/usr/bin/env bash
# Rebuild the TEST database from nothing, so that a red batch means something again.
#
# ## WHY THIS EXISTS, AND IT IS NOT ABOUT GREEN
#
# db-test is cumulative. By 2026-10-18 it held 9,077 active users, 356,062 audit rows and 47 roles,
# and the symptom was always the same: a 12-file batch goes red, the spec passes 11/11 alone, and the
# contention explanation is CORRECT. It was correct four times. That is the problem — a red that gets
# explained every time is a red nobody reads, and the next one will be dismissed the same way whether
# or not it deserves to be.
#
# `from-empty.sh` already states this discipline about its own skip path: "a gate that goes red for an
# environmental reason is one everybody learns to ignore — which is how a real failure gets dismissed
# later." That sentence was written about `check-ci.sh`. This script applies it to db-test.
#
# The goal is therefore NOT a green suite. It is that a red batch becomes a finding.
#
# ## THE DEV DATABASE CANNOT BE REACHED FROM HERE, AND THAT IS A CONTROL RATHER THAN A CONVENTION
#
# Dev holds the owner's demo data — two organizations, 512 customers, 30 policies, 27 invoices, 16
# claims — and her paired authenticator. Re-seeding it costs her nine minutes, a re-pairing, and the
# data the rest of her walk depends on.
#
# The two are already separate: `db` on host 5433 with volume `db-data`, `db-test` on 5434
# (container `ibms-app-db-test-1`) with volume `db-test-data`. But "pointed at the right one" is a
# keystroke from the wrong one, so this REFUSES unless every one of these holds:
#
#   * the container it will operate on is named exactly `ibms-app-db-test-1`
#   * that container publishes host port 5434 — read from Docker, not from a variable
#   * `DATABASE_URL` in `.env.test` names port 5434 AND database `ibms_test`
#   * the dev port 5433 appears nowhere in the resolved target
#
# Every value is re-derived here rather than taken on trust, and the database name is hard-coded as a
# constant that is compared against the URL rather than parsed out of it — so an edited `.env.test`
# cannot redirect this script, it can only make it refuse.
#
# ## IT SKIPS RATHER THAN FAILS WITHOUT DOCKER, AND A SKIP IS NOT A PASS
#
# Same shape as `from-empty.sh`, and for the same reason: a machine without the container is not a
# tree with a defect.
#
# Usage:  bash scripts/reset-db-test.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER=ibms-app-db-test-1
EXPECT_PORT=5434
EXPECT_DB=ibms_test
DEV_PORT=5433

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nreset-db-test: REFUSED — %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- skip, loudly
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "reset-db-test: SKIPPED — the ${CONTAINER} container is not running."
  echo "reset-db-test: this is a skip, NOT a pass. Nothing was reset, and any suite you run now"
  echo "reset-db-test: is still running against whatever db-test already held."
  echo "reset-db-test: run \`docker compose up -d db-test\` and try again."
  exit 0
fi

# ---------------------------------------------------------------- the refusals
say "proving the target is the TEST instance and not dev"

PUBLISHED="$(docker port "$CONTAINER" 5432/tcp 2>/dev/null | head -1)"
[ -n "$PUBLISHED" ] || die "could not read the published port of ${CONTAINER} from Docker."
HOST_PORT="${PUBLISHED##*:}"
printf '  container %s publishes host port %s\n' "$CONTAINER" "$HOST_PORT"
[ "$HOST_PORT" = "$EXPECT_PORT" ] || die \
  "${CONTAINER} publishes ${HOST_PORT}, not ${EXPECT_PORT}. That is not the test instance this script may touch."

URL="$(grep -E '^DATABASE_URL=' .env.test 2>/dev/null | head -1 | cut -d= -f2-)"
[ -n "$URL" ] || die "no DATABASE_URL in .env.test — refusing to guess a target."
MASKED="$(printf '%s' "$URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"
printf '  .env.test DATABASE_URL  %s\n' "$MASKED"

case "$URL" in
  *":${EXPECT_PORT}/${EXPECT_DB}"*) : ;;
  *) die "DATABASE_URL does not name :${EXPECT_PORT}/${EXPECT_DB}. Refusing." ;;
esac
case "$URL" in
  *":${DEV_PORT}"*) die "DATABASE_URL mentions the DEV port ${DEV_PORT}. Refusing outright." ;;
esac

# The database this script will DROP is a constant here, compared against the URL above. It is never
# parsed out of the URL, so no edit to `.env.test` can redirect the DROP — it can only make the
# comparison fail and stop the run.
printf '  will drop and recreate  %s on %s\n' "$EXPECT_DB" "$CONTAINER"

# And the dev container, if it is running, is named so a reader can see it is a different thing.
DEVNAME="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -x 'ibms-app-db-1' || true)"
if [ -n "$DEVNAME" ]; then
  DEVPORT="$(docker port ibms-app-db-1 5432/tcp 2>/dev/null | head -1)"
  printf '  dev container %s is running on %s and is NOT touched\n' "$DEVNAME" "${DEVPORT##*:}"
fi

# ---------------------------------------------------------------- the reset
say "dropping and recreating ${EXPECT_DB}"
# `postgres` is the maintenance database: you cannot drop the database you are connected to. FORCE
# terminates the connections a previous suite left behind, which is otherwise the usual reason a drop
# hangs rather than fails.
docker exec -i "$CONTAINER" psql -U ibms -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${EXPECT_DB}\" WITH (FORCE)" \
  || die "could not drop ${EXPECT_DB}."
docker exec -i "$CONTAINER" psql -U ibms -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${EXPECT_DB}\"" \
  || die "could not create ${EXPECT_DB}."

# THE `ibms_app` ROLE IS A CLUSTER OBJECT AND SURVIVES THE DROP, which is why this is a guarded
# create rather than an unconditional one. Measured: no migration CREATEs it — they only GRANT to it
# by name — so on a cluster where it is absent every migration that grants would fail. `from-empty.sh`
# makes the same guarded create for the same reason.
say "ensuring the ibms_app runtime role exists (cluster-level, survives the drop)"
docker exec -i "$CONTAINER" psql -U ibms -d "$EXPECT_DB" -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ibms_app') THEN CREATE ROLE ibms_app LOGIN PASSWORD 'ibms_app'; END IF; END \$\$;" \
  >/dev/null || die "could not ensure the ibms_app role."

say "applying every migration to the empty database"
npm run db:test:migrate:deploy || die "migrate deploy failed on an empty ${EXPECT_DB}."

say "seeding"
npm run db:test:seed || die "the seed failed."

# ---------------------------------------------------------------- prove it
say "the gates the test path depends on"
fail=0
gate() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  ok    %s\n' "$name"
  else printf '  FAIL  %s\n' "$name"; fail=1; fi
}
gate "migration checksums"            npm run db:test:checksums
gate "schema divergence"              npm run db:test:divergence
gate "runtime role privileges"        npm run db:test:privileges
gate "permission fixture still matches" npm run db:test:fixture:permissions:check

say "what the clean database holds"
docker exec -i "$CONTAINER" psql -U ibms -d "$EXPECT_DB" -c "
SELECT (SELECT count(*) FROM \"Organization\")  AS organizations,
       (SELECT count(*) FROM \"User\")          AS users,
       (SELECT count(*) FROM \"Role\")          AS roles,
       (SELECT count(*) FROM \"AuditLogEntry\") AS audit_rows,
       (SELECT count(*) FROM \"Permission\")    AS permissions;"

if [ "$fail" != "0" ]; then
  echo
  echo "reset-db-test: the database was rebuilt but a gate FAILED above — do not run the suite"
  echo "reset-db-test: against it until that is understood."
  exit 1
fi

say "RESET COMPLETE — a red batch from here is a FINDING, not contention"
