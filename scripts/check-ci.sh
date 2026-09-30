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
#   HEAD is pushed, all succeeded    -> pass, ONLY IF the check-runs also pass (see below).
#
# ## WORKFLOW RUNS ARE NOT THE WHOLE STORY, and this gate reported a false green on 2026-09-30
#
# `gh run list` lists WORKFLOW runs. A CHECK-RUN is a different object, and an app can post one with no
# workflow behind it — GitHub Advanced Security posts `CodeQL` that way to report code-scanning alerts.
# On `b366561` both workflow runs concluded `success` while the `CodeQL` check-run was `failure` with one
# new high-severity alert, and this script printed "2 run(s), all green". It was believed and reported.
#
# So there are two passes now, and the second is the one that catches a scanner: every check-run attached
# to the commit must have concluded, and must have concluded `success`, `neutral` or `skipped`. The first
# pass is kept rather than replaced — a workflow that never started posts no check-run at all, which the
# check-run pass alone would read as a clean commit.
#
# `gh` missing or unauthenticated is a FAILURE, deliberately: "I could not check" is precisely the state
# that produced the incident above.
set -uo pipefail

# An optional commit-ish, so this gate can be run against a PAST commit and thereby be TESTED. It was
# not, and the false green it printed on `b366561` could only be reproduced by checking that commit out.
# `verify.sh` passes nothing and gets HEAD, which is the only use that matters in a run.
sha="$(git rev-parse "${1:-HEAD}")"
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
console.log(`check-ci: ${short} — ${ok.length} workflow run(s), all green.`);
NODE
runs_status=$?

# PASS 2 — the check-runs. See the header: a scanner's check-run can fail while every workflow succeeds.
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)"
checks="$(gh api "repos/${repo}/commits/${sha}/check-runs" --paginate \
  --jq '.check_runs[] | "\(.conclusion // "pending")\t\(.name)\t\(.html_url)"' 2>/dev/null)"

checks_status=0
if [ -z "$checks" ]; then
  echo "check-ci: no check-runs are attached to ${short}. The workflow pass above is the only signal,"
  echo "check-ci: which is weaker than it looks — treat a green as provisional."
else
  bad=0
  while IFS="$(printf '\t')" read -r conclusion name url; do
    [ -z "$name" ] && continue
    case "$conclusion" in
      success|neutral|skipped) ;;
      *)
        echo "check-ci: check-run '${name}' is ${conclusion} on ${short} — ${url}"
        bad=$((bad + 1))
        ;;
    esac
  done <<EOF
$checks
EOF
  if [ "$bad" -gt 0 ]; then
    echo "check-ci: ${bad} check-run(s) are not green on ${short}. A failing check-run with every workflow"
    echo "check-ci: green is exactly the false green this gate produced once — read it, do not count it."
    checks_status=1
  else
    echo "check-ci: ${short} — every check-run green too."
  fi
fi

if [ "$runs_status" -ne 0 ] || [ "$checks_status" -ne 0 ]; then
  exit 1
fi
exit 0
