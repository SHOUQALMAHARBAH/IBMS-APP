#!/usr/bin/env bash
# Smoke test: boots the real service (not a mock) via `npm run start` and
# asserts its actual job — answering health checks, including one that
# proves it can reach the database — then tears it down. Run from apps/api
# (as `npm run test:smoke` does) or via `bash scripts/smoke.sh api` from repo
# root, which dispatches here.
set -euo pipefail
set -m # job control on: puts the background job in its own process group, so the
       # cleanup trap can kill that whole group — `npm run start` wraps `nest start`
       # wraps the actual node process, and killing only the outer npm PID can leave
       # the innermost one (and its held-open Prisma engine file) running.

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${PORT:-4000}"
BASE_URL="http://localhost:${PORT}"

npm run start >/tmp/ibms-api-smoke.log 2>&1 &
PID=$!

cleanup() {
  kill -- "-${PID}" >/dev/null 2>&1 || kill "$PID" >/dev/null 2>&1 || true
  wait "$PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "smoke: waiting for ${BASE_URL}/health ..."
for _ in $(seq 1 30); do
  if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "${BASE_URL}/health" >/dev/null; then
  echo "smoke: FAILED — service never became healthy" >&2
  cat /tmp/ibms-api-smoke.log >&2
  exit 1
fi

echo "smoke: GET /health"
curl -sf "${BASE_URL}/health"
echo

echo "smoke: GET /health/db (proves the service can reach Postgres, not just that the process is alive)"
curl -sf "${BASE_URL}/health/db"
echo

echo "smoke: GET /auth/me with no token (proves the auth guard is really wired into the running app, not just covered by tests)"
status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/auth/me")"
if [ "$status" != "401" ]; then
  echo "smoke: FAILED — expected 401 Unauthorized, got ${status}" >&2
  exit 1
fi
echo "smoke: got 401 as expected"

echo "smoke: OK"
