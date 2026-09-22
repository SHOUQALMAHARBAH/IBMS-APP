#!/usr/bin/env bash
# Runs every gate in ibms-brain/meta/context/verification-contract.md § Backend/frontend
# gate commands and prints each gate's real evidence — exit code, and a test count where
# the tool reports one — never a claim. This is the local/agent equivalent of what CI
# runs as separate `frontend`/`backend` jobs; here they run in one place so the full
# evidence bundle can be pasted into a PR description in one shot.
#
# Precondition: the test database is up and migrated.
#   cp .env.test.example .env.test   # first time only
#   npm run db:test:migrate:dev      # first time, or after a schema change
# This script brings db-test up itself (idempotent) but does not migrate it — a pending
# migration should fail the "Database migrations" gate below, not be silently applied.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env.test ]; then
  echo "verify: .env.test not found — copy .env.test.example to .env.test first (see README § Dev DB vs. test DB)" >&2
  exit 1
fi

echo "verify: starting db-test ..."
docker compose up -d db-test >/dev/null

RESULTS=()
ANY_FAILED=0

gate() {
  local label="$1"; shift
  echo ""
  echo "===== ${label} ====="
  local log
  log="$(mktemp)"
  "$@" >"$log" 2>&1
  local code=$?
  cat "$log"
  local evidence="exit ${code}"
  if [ "$code" -eq 0 ]; then
    # Sum every "N passed" count in the log, not just the last one — a gate that
    # fans out across workspaces (e.g. `npm run test` runs both api and web) prints
    # one "Tests N passed" line per workspace, and Vitest's own "Test Files N passed"
    # line matches the same pattern, so both must be accounted for correctly:
    # exclude "Test Files" lines (a file count, not a test count) and sum the rest.
    local total
    total="$(grep -v 'Test Files' "$log" | grep -oE '[0-9]+ passed' | awk '{s+=$1} END{if (NR>0) print s}')"
    [ -n "$total" ] && evidence="exit 0, ${total} passed"
  else
    evidence="exit ${code} (FAILED)"
    ANY_FAILED=1
  fi
  rm -f "$log"
  RESULTS+=("${label} -> ${evidence}")
}

gate "Types"               npm run typecheck
gate "Lint"                npm run lint
gate "Unit Tests"          npm run test
gate "Security"            npm run test:security
gate "Database Schema"     npm run db:validate
gate "Database Migrations" npm run db:test:migrate:deploy
# `migrate status` reports whether every migration has been APPLIED. It does NOT compare an
# applied migration's stored checksum against its file — measured: with a drifted migration
# present it still printed "Database schema is up to date!". This gate used to be labelled
# "drift check", which claimed a guarantee it did not provide.
gate "Database Migrations (all applied)" npm run db:test:migrate:status
gate "Database Migrations (checksum drift)" npm run db:test:checksums
# And the third distinct property, which nothing checked either: whether schema.prisma still
# describes what the database enforces. `migrate status` never reads schema.prisma at all.
gate "Database Schema (divergence from the database)" npm run db:test:divergence
# And the privilege surface, which neither of the two above looks at: a GRANT of owner
# membership leaves rolsuper FALSE and lets the runtime role read past every RLS policy.
gate "Database Privileges (runtime role)" npm run db:test:privileges
gate "Database Seed"       npm run db:test:seed
# The THIRD copy of the role -> permission grid: Playwright mocks `/auth/me` from a checked-in
# fixture, and a mock missing a code renders an empty nav because the sidebar helpers fail
# CLOSED. A stale copy has already broken four Playwright tests across three files, in files
# that had nothing to do with the change. Placed AFTER the seed gate, because it compares the
# fixture against the freshly seeded grid rather than against the declaration.
# Reads .env.test, like every gate around it: this runs immediately after the db-test seed, so
# it compares the fixture against the grid that was just written rather than against dev's.
# The two are asserted byte-identical elsewhere; this gate should still read the one it seeded.
gate "Permission Fixture (web e2e mirror)" npm run db:test:fixture:permissions:check
gate "Integration Tests"   npm run test:e2e
gate "Contract Tests"      npm run test:contract
gate "Smoke Tests"         bash scripts/smoke.sh api
gate "Accessibility"       npm run test:a11y
gate "E2E"                 npm run e2e
gate "Build"               npm run build
# A Playwright version bump downloads a new browser revision and leaves the old one on disk
# forever; Playwright resolves by revision directory, so the old one is unreachable weight.
# 1.21 GB of it was found by accident on 2026-09-21. This is the witness that was missing.
gate "Playwright browsers"  npm run browsers:check

# Housekeeping, deliberately NOT a gate — it must never fail a verification run. Turborepo has
# no size cap on its local cache and this one reached 36 GB in ten days (~3.6 GB/day), filling
# the disk to 5.4% free. Runs last, after the gates above have had their cache hits.
echo ""
echo "--- housekeeping: turbo cache ---"
node scripts/prune-turbo-cache.mjs || true

echo ""
echo "===================== verification summary ====================="
printf '%s\n' "${RESULTS[@]}"
echo "==================================================================="

exit "$ANY_FAILED"
