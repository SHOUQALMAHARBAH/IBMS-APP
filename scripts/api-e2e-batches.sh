#!/usr/bin/env bash
# Run the api e2e suite in foreground batches, and FAIL when a batch did not run what it was given.
#
# ## WHY THIS EXISTS — the measurement lied in the safe-looking direction
#
# On 2026-10-18 a batch reported, and exited 0:
#
#     Test Files  8 passed (8)
#     Tests      93 passed (93)
#     Errors      9 errors
#
# The same twelve spec names had run 17 files / 129 tests an hour earlier. Every one of the nine
# errors was `Worker exited unexpectedly with exit code 3221225794 during starting state` —
# 0xC0000374, heap corruption — so NINE WORKER FORKS NEVER STARTED and the files they would have run
# were silently not run. Vitest exited 0 because nothing it managed to run had failed.
#
# A PASS COUNT IS NOT A COVERAGE COUNT. That is the same class as every other finding in this
# module: a green that is green because the check never looked. Reading the `Errors` line catches it,
# and reading a line is a habit — habits lapse under time pressure, which is exactly when a
# half-finished suite gets reported as a clean one. So it becomes a gate instead.
#
# ## WHAT MAKES A BATCH FAIL HERE
#
#   1. vitest's own exit code, as always.
#   2. An `Errors N` line with N > 0 — even when every test that ran passed.
#   3. A `Test Files` count BELOW the number of spec files the batch's filters actually match.
#      Computed from the filesystem, not trusted: a filter matching fewer files than it should is the
#      same defect arriving quietly instead of as a crash.
#
# (3) is deliberately one-sided. MORE files than expected is not an error — a substring filter
# legitimately matches siblings (`audit` matches `audit-actor-search` too) — and the expectation is
# computed with the same substring rule vitest uses, so the floor is honest rather than approximate.
#
# ## WHY FOREGROUND BATCHES AT ALL
#
# Measured on this host, four times: a single run over all 122 spec files spawns 122 workers and the
# machine dies part-way (register entry 35), and a background invocation is killed with little or no
# output. Batches of ~12 in the foreground are what completes. CI runs the suite UNFILTERED on a
# database built from nothing and is the authority for a widening; this is the local instrument.
#
# Usage:  bash scripts/api-e2e-batches.sh             # every spec, in batches
#         bash scripts/api-e2e-batches.sh 3           # just batch 3
#         BATCH_SIZE=8 bash scripts/api-e2e-batches.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/api"

BATCH_SIZE="${BATCH_SIZE:-12}"
ONLY="${1:-}"
CONTAINER=ibms-app-db-test-1

# Skips rather than fails without the container, and says a skip is not a pass — the same shape as
# `from-empty.sh` and `reset-db-test.sh`.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "api-e2e-batches: SKIPPED — the ${CONTAINER} container is not running."
  echo "api-e2e-batches: this is a skip, NOT a pass. No spec was executed."
  exit 0
fi

mapfile -t SPECS < <(ls test/*.e2e-spec.ts | sed 's|test/||; s|\.e2e-spec\.ts||' | sort)
TOTAL=${#SPECS[@]}
[ "$TOTAL" -gt 0 ] || { echo "api-e2e-batches: found NO spec files, which is not a clean result"; exit 1; }

# How many spec FILES a set of filters matches, by vitest's own rule: a filter matches a file when it
# appears anywhere in the path. Computed rather than assumed, because the whole point of check (3) is
# that the expected number must not come from the same place as the actual one.
expected_files() {
  local -a names=("$@")
  local count=0 f n
  for f in "${SPECS[@]}"; do
    for n in "${names[@]}"; do
      case "$f" in *"$n"*) count=$((count + 1)); break ;; esac
    done
  done
  echo "$count"
}

LOGDIR="$(mktemp -d)"
overall=0
batch=0
i=0
while [ "$i" -lt "$TOTAL" ]; do
  batch=$((batch + 1))
  slice=("${SPECS[@]:i:BATCH_SIZE}")
  i=$((i + BATCH_SIZE))
  if [ -n "$ONLY" ] && [ "$ONLY" != "$batch" ]; then continue; fi

  want="$(expected_files "${slice[@]}")"
  log="$LOGDIR/batch-$batch.log"

  npx dotenv -e ../../.env.test -- npx vitest run --config test/vitest-e2e.config.ts "${slice[@]}" \
    >"$log" 2>&1
  code=$?

  clean="$(sed 's/\x1b\[[0-9;]*m//g' "$log")"
  files="$(printf '%s' "$clean" | grep -oE 'Test Files +[0-9]+ (passed|failed)' | grep -oE '[0-9]+' | head -1)"
  tests="$(printf '%s' "$clean" | grep -oE 'Tests +[0-9]+ (passed|failed)' | grep -oE '[0-9]+' | head -1)"
  errs="$(printf '%s' "$clean" | grep -oE 'Errors +[0-9]+ error' | grep -oE '[0-9]+' | head -1)"
  files="${files:-0}"; tests="${tests:-0}"; errs="${errs:-0}"

  bad=0
  [ "$code" != "0" ] && bad=1
  [ "$errs" -gt 0 ] && bad=1
  [ "$files" -lt "$want" ] && bad=1

  printf 'batch %-2s  exit=%-2s files=%s/%s tests=%s errors=%s  %s\n' \
    "$batch" "$code" "$files" "$want" "$tests" "$errs" \
    "$([ "$bad" = 0 ] && echo ok || echo FAIL)"

  if [ "$bad" != "0" ]; then
    overall=1
    if [ "$errs" -gt 0 ]; then
      echo "    ${errs} ERROR(S) — tests that never RAN. The most common is a worker that failed to"
      echo "    start, which exits 0 with only passes printed. Lines:"
      printf '%s' "$clean" | grep -E 'Worker exited|Unhandled Error|Caused by' | head -4 | sed 's/^/      /'
    fi
    if [ "$files" -lt "$want" ]; then
      echo "    ONLY ${files} of ${want} spec file(s) ran. These filters matched files that produced"
      echo "    no result:"
      for n in "${slice[@]}"; do
        printf '%s' "$clean" | grep -q "$n" || echo "      $n"
      done
    fi
    printf '%s' "$clean" | grep -E '^ +(×|✕)' | head -6 | sed 's/^/    /'
    echo "    full log: $log"
  fi
done

echo
if [ "$overall" != "0" ]; then
  echo "api-e2e-batches: FAILED. A batch either reported a failing test, or did not run everything it"
  echo "api-e2e-batches: was given. The second kind exits 0 on its own and is the reason this wrapper"
  echo "api-e2e-batches: exists — a pass count is not a coverage count."
  exit 1
fi
echo "api-e2e-batches: every batch ran every file it was given, and all of them passed."
