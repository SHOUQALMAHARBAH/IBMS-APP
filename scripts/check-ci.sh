#!/usr/bin/env bash
#
# IS CI GREEN FOR THE COMMIT I AM STANDING ON?
#
# This exists because of a measured failure, not as ceremony. On 2026-09-24 the backend job went red on
# `477965d` with a real e2e failure that named four wrong route gates — and it was not read. Four
# commits later a second gate started failing EARLIER in the same job, which short-circuited it, so the
# first failure disappeared behind the newer one and the api e2e suite stopped running at all. Every
# local gate was green throughout, and the work was reported as verified.
#
# "CI gates the branch" is vacuous unless something makes a person look. This is that something.
#
# States and what each means:
#
#   HEAD is not on the remote        -> pass, with a note. CI cannot have run a commit nobody has.
#   HEAD is pushed, no run yet       -> FAIL. Either it is still queued (wait) or the workflow does not
#                                      trigger on this branch, which is the same blind spot.
#   HEAD is pushed, a run failed     -> FAIL, and print which job, so the failure is named not counted.
#   HEAD is pushed, runs in progress -> FAIL. An unfinished run is not evidence.
#   HEAD is pushed, all succeeded    -> pass.
#
# `gh` missing or unauthenticated is a FAILURE, deliberately: "I could not check" is precisely the state
# that produced the incident above.
set -uo pipefail

sha="$(git rev-parse HEAD)"
short="${sha:0:7}"

if ! command -v gh >/dev/null 2>&1; then
  echo "check-ci: the GitHub CLI is not installed, so CI status for ${short} cannot be read."
  echo "check-ci: install gh and run 'gh auth login'. Not being able to check is the state this gate exists for."
  exit 1
fi

# Is this commit on the remote at all? If not, CI has nothing to say and that is not a failure.
if ! git branch -r --contains "$sha" >/dev/null 2>&1 || [ -z "$(git branch -r --contains "$sha" 2>/dev/null)" ]; then
  echo "check-ci: ${short} is not on any remote branch yet — nothing to check. Push, then run this again."
  exit 0
fi

runs="$(gh run list --commit "$sha" --limit 20 --json status,conclusion,workflowName,databaseId 2>/dev/null)"
if [ -z "$runs" ] || [ "$runs" = "[]" ]; then
  echo "check-ci: ${short} is pushed and NO workflow run exists for it."
  echo "check-ci: either it is still queued, or the workflow does not trigger for this branch — and a"
  echo "check-ci: branch whose pushes run nothing is a branch with no CI. Open the PR."
  exit 1
fi

# Passed by ENVIRONMENT, not argv: with `node -` reading from stdin, argv[1] is "-" and the first
# real argument lands at argv[2] — the same off-by-one that made three plants silently no-op.
RUNS="$runs" SHORT="$short" node - <<'NODE'
const json = process.env.RUNS;
const short = process.env.SHORT;
let runs;
try {
  runs = JSON.parse(json);
} catch (err) {
  console.log(`check-ci: could not parse the run list: ${String(err)}`);
  process.exit(1);
}
const unfinished = runs.filter((r) => r.status !== 'completed');
const failed = runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out');
const ok = runs.filter((r) => r.conclusion === 'success');

for (const r of runs) {
  console.log(`  ${r.workflowName}: ${r.status}${r.conclusion ? ` / ${r.conclusion}` : ''} (run ${r.databaseId})`);
}

if (failed.length > 0) {
  console.log(`check-ci: ${short} has ${failed.length} FAILING run(s). Read them before reporting anything green:`);
  for (const r of failed) console.log(`  gh run view ${r.databaseId} --log-failed`);
  process.exit(1);
}
if (unfinished.length > 0) {
  console.log(`check-ci: ${short} has ${unfinished.length} run(s) still going. An unfinished run is not evidence.`);
  process.exit(1);
}
console.log(`check-ci: ${short} — ${ok.length} run(s), all green.`);
NODE
