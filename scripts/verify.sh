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
gate "Database Migrations (drift check)" npm run db:test:migrate:status
gate "Integration Tests"   npm run test:e2e
gate "Contract Tests"      npm run test:contract
gate "Smoke Tests"         bash scripts/smoke.sh api
gate "Accessibility"       npm run test:a11y
gate "E2E"                 npm run e2e
gate "Build"               npm run build

echo ""
echo "===================== verification summary ====================="
printf '%s\n' "${RESULTS[@]}"
echo "==================================================================="

exit "$ANY_FAILED"
