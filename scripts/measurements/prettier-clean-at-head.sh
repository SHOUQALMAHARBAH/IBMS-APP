#!/usr/bin/env bash
#
# IS THIS FILE PRETTIER-CLEAN AT HEAD? — which decides whether `prettier --write` is safe on it.
#
# ## WHY THIS SCRIPT EXISTS
#
# The repository rule is that `npx prettier --write` is only safe on a file that is ALREADY
# prettier-clean, because reformatting an unclean one turns a small edit into a sweep — measured
# once at 1,791+/767- where the real change was 604+/175-.
#
# Checking that needs the file AS IT WAS AT HEAD, and the obvious one-liner is wrong in a way that
# reports the ANSWER YOU FEAR rather than an error:
#
#     cd "$(dirname "$f")" && git show "HEAD:$f" > probe.ts && npx prettier --check probe.ts
#
# `npx` resolves prettier from the repo root, so a BARE relative filename is looked for relative to
# the ROOT and not the cwd. Prettier then prints
#
#     [error] No files matching the pattern were found: "probe.ts"
#
# and exits NON-ZERO — which a `&& … || echo UNCLEAN` shell idiom reads as "unclean". So every file
# comes back unclean, every time, and the habit that follows is hand-editing files that `--write`
# would have handled. That happened repeatedly in this session before it was noticed, and the
# recorded advice ("put the probe in the file's own directory") is the half that misleads: the
# directory is fine, the PATH has to be relative to where prettier is invoked.
#
# ## WHAT THIS DOES
#
# Invokes prettier from the WORKSPACE root with a workspace-relative path, and distinguishes three
# outcomes rather than two — because "the probe found nothing" must never be reported as a verdict
# about the file.
#
# Usage:  bash scripts/measurements/prettier-clean-at-head.sh <file> [<file> …]
#
# The workspace is derived from the path (`apps/api`, `apps/web`, `packages/db`), since that is
# where each one's prettier config and `package.json` live.
set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root" || exit 1

status=0

workspace_for() {
  case "$1" in
    apps/api/*) echo "apps/api" ;;
    apps/web/*) echo "apps/web" ;;
    packages/db/*) echo "packages/db" ;;
    *) echo "" ;;
  esac
}

for f in "$@"; do
  ws="$(workspace_for "$f")"
  if [ -z "$ws" ]; then
    echo "SKIPPED           $f — not inside a workspace with its own prettier config"
    continue
  fi

  rel="${f#"$ws"/}"
  dir="$(dirname "$f")"
  base="$(basename "$f")"
  probe="zz-prettier-probe-$base"

  if ! git show "HEAD:$f" > "$dir/$probe" 2>/dev/null; then
    rm -f "$dir/$probe"
    echo "NOT AT HEAD       $f — a new file, so --write is safe: there is nothing to churn"
    continue
  fi

  probe_rel="$(dirname "$rel")/$probe"
  out="$(cd "$ws" && npx prettier --check "$probe_rel" 2>&1)"
  rm -f "$dir/$probe"

  # THREE OUTCOMES, NOT TWO. "The probe found nothing" is a broken measurement and must be said as
  # one — reporting it as UNCLEAN is exactly the failure this script exists to end.
  if printf '%s' "$out" | grep -q "No files matching"; then
    echo "PROBE BROKEN      $f — prettier could not find the probe; do not trust any verdict here"
    status=1
  elif printf '%s' "$out" | grep -q "All matched files use Prettier code style"; then
    echo "CLEAN at HEAD     $f — \`prettier --write\` is safe on it"
  else
    echo "UNCLEAN at HEAD   $f — hand-write the edit in the house style; --write would sweep it"
  fi
done

exit "$status"
