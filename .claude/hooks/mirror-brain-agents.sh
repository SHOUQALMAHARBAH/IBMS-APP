#!/bin/bash
# Claude Code hook: PostToolUse (matcher: Write|Edit)
#
# ibms-brain's own mirror-agents.sh (ibms-brain/.claude/hooks/mirror-agents.sh) keeps
# ibms-brain/.claude/{agents,commands}/ in sync with ibms-brain/meta/{agents,templates}/
# — but only within an ibms-brain session. A Claude Code session opened at ibms-app's
# root does not discover .claude/agents/ or .claude/commands/ inside a nested git
# submodule at all, so without this second-level mirror, @code-reviewer,
# @software-developer, and /brain-gap are invisible from ibms-app.
#
# This copies ibms-brain's already-mirrored copies straight through — it does not read
# meta/agents/ or meta/templates/ directly, so it stays correct regardless of where
# ibms-brain's own source-of-truth files live.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -z "$REPO_ROOT" ] && exit 0

mirror() {
  local src="$1" dst="$2"
  [ -d "$src" ] || return 0
  mkdir -p "$dst"
  for f in "$src"/*.md; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    if ! cmp -s "$f" "$dst/$base"; then
      cp -f "$f" "$dst/$base"
      echo "  mirrored: ${src#"$REPO_ROOT"/} -> ${dst#"$REPO_ROOT"/}/$base"
    fi
  done
}

mirror "$REPO_ROOT/ibms-brain/.claude/agents" "$REPO_ROOT/.claude/agents"
mirror "$REPO_ROOT/ibms-brain/.claude/commands" "$REPO_ROOT/.claude/commands"

exit 0
