#!/usr/bin/env python
"""
WHICH ibms-brain GUARDS ACTUALLY RUN IN THIS REPOSITORY, AND WHICH DELIBERATELY DO NOT.

    python scripts/measurements/hook-registration.py            # report
    python scripts/measurements/hook-registration.py --check     # gate, fails BOTH directions
    python scripts/measurements/hook-registration.py --self-test # prove it can fail

## Why this exists

`ibms-brain/.claude/hooks/` holds six enforcement hooks. The brain's own `settings.json`
registers all six. **This repository registered two** — and nothing anywhere said so in a
form a gate could read, so four guards, including the money-arithmetic and sensitive-data
ones, did not run while anyone worked on the system. The absence was recorded in prose in
`README.md` § `.claude/` and was correct; prose does not fail a build.

**And the registration shape made absence look like success.** Every entry ended:

    [ -f "$script" ] && exec bash "$script" || true

`|| true` on the line that DECIDES whether the guard runs. A missing or renamed hook exited
0, which is indistinguishable from a clean pass — the same family as the missing `jq` binary
that turned two CI watches into silence while the build was red.

## What this gate asserts

1. The set of registered hooks equals `REGISTERED` below — **in both directions**. A guard
   appearing is as much a finding as one disappearing: it means somebody wired a hook without
   measuring what it refuses.
2. Every registered hook EXISTS and is readable in the submodule.
3. No registration swallows its own absence (`|| true` at the end of the command).
4. Every `.sh` in the brain's hooks directory is recorded in git as `100755`. With
   `core.filemode = false` the local mode is not what a fresh clone gets, and all seven were
   recorded `100644` until 2026-11-07 — so on CI, or on a colleague's machine, the brain's
   own `[ -x "$script" ]` registrations would have skipped every guard in silence.
5. Every hook NOT registered is named in `NOT_REGISTERED` **with the command that proves the
   claim**, because an item recorded as not-built must carry its own disproof. That rule was
   earned: a deferred row once described a gate as "sized, not attempted" when it had been
   built and was already running in CI.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SETTINGS = os.path.join(ROOT, ".claude", "settings.json")
BRAIN_HOOKS = os.path.join(ROOT, "ibms-brain", ".claude", "hooks")

#: Brain hooks that run in THIS repository. Each was measured BEFORE being wired; the figure
#: is how many tracked files the guard would have refused on the tree as it stood.
REGISTERED = {
    "enforce-workspace-updates.sh": (
        "PreToolUse/Bash — blocks a commit that stages developer-facing files without "
        "CLAUDE.md + README.md."
    ),
    "enforce-credential-safety.sh": (
        "PreToolUse/Bash — blocks a command that would write credential material to disk. "
        "UNTOUCHED BY INSTRUCTION: nobody reads credential values, and nothing may weaken this."
    ),
    "enforce-money-decimal.sh": (
        "PreToolUse/Write|Edit — wired 2026-11-07, after `tax` and `fees` were added to its "
        "word list. Measured first: blocks 0 of 1,712 tracked .ts/.tsx files, so it refuses "
        "nothing already correct."
    ),
    "enforce-sensitive-data.sh": (
        "PreToolUse/Write|Edit — wired 2026-11-07. Measured first: blocks 0 lines in 1,861 "
        "tracked files, raw or tokenised, so no existing log call trips it. No CI gate "
        "answers this question."
    ),
}

#: Brain hooks deliberately NOT registered here. Each carries the measurement and, per rule 5
#: above, THE COMMAND THAT PROVES THE CLAIM.
NOT_REGISTERED = {
    "enforce-state-transitions.sh": (
        "Would block 63 of 1,861 tracked files, and none of the three classes is a violation: "
        "~40 are test fixtures seeding a scenario, 2 are filter builders "
        "(`where.status = filter.status`), and the rest write a `status` column on an entity "
        "the lex does not govern (PaymentChannel, SlaPolicy, ServiceRequest, Role, ...). "
        "Structural: the lex names the governed entities, and a hook seeing one edit cannot "
        "resolve that list. The question IS gated, correctly and in CI, by the spec below. "
        "DATED REVIEW: 2027-02-08, recorded in the lex too -- re-run the scan then, because "
        "a 63-of-1,861 measurement with no review date becomes a comfortable ceiling.",
        "npx vitest run apps/api/src/modules/workflow/status-writes.inventory.spec.ts",
    ),
    # CORRECTED 2026-11-08. The previous reason said the guard was IMPOSSIBLE to satisfy
    # because "scripts/verify.sh never writes that file and there is no artifacts/
    # directory". The CONCLUSION (do not wire it here) still holds; the stated CAUSE was
    # false, and so was the command recorded as proving it.
    #
    # THERE ARE TWO FILES CALLED `scripts/verify.sh`, ONE PER REPOSITORY, AND THE OLD
    # COMMAND READ THE WRONG ONE:
    #
    #     scripts/verify.sh              (this repo, 8105 bytes)  gates.json x0
    #     ibms-brain/scripts/verify.sh   (the brain, 2933 bytes)  gates.json x3
    #
    # `enforce-evidence.sh` lives in the brain and implements the brain's verify.sh, which
    # creates `artifacts/$SHA` at line 13, writes `gates.json` at line 52 and prints
    # `recorded -> ...` at line 60. Run from this repo's root, `grep -c gates.json
    # scripts/verify.sh` returns 0 about a DIFFERENT script -- the answer that made the
    # claim look true. `ibms-brain/meta/lex/definition-of-done.md` has carried the correct
    # account all along, and it carries the `ibms-brain/`-qualified path that this record
    # dropped.
    #
    # And `test -d artifacts` was the second half of the same error: nothing is TRACKED
    # under artifacts/ in either repo (measured: 0 and 0) because it is a GENERATED
    # directory. "Not tracked" is not "not written".
    "enforce-evidence.sh": (
        "Blocks `git push` unless artifacts/<sha>/gates.json exists and every gate in it "
        "passes -- and `skip` and `n/a` are non-failing, so a gates.json that the brain's "
        "verify.sh produces DOES satisfy it. Not wired here for two measured reasons, "
        "neither of which is impossibility. (1) THE COST: the path is keyed on the commit "
        "sha, so the evidence must be regenerated after every commit, and this repo's "
        "gates are a full typecheck/lint/unit/e2e pass rather than the brain's one "
        "documentation check. (2) THIS REPO'S OWN scripts/verify.sh WRITES NO gates.json "
        "AT ALL (0 occurrences), so until it does there is nothing here for the guard to "
        "read -- and the guard resolves its root with `git rev-parse --show-toplevel`, the "
        "exact call batch 7 replaced in the registrations, which inside the submodule "
        "returns the brain's root and would look for artifacts/ in the wrong repository. "
        "DATED REVIEW: 2027-02-08 -- a not-wired record with no review date becomes a "
        "comfortable ceiling. Re-run the command below; if this repo's verify.sh has "
        "gained a gates.json writer, the decision changes.",
        "grep -c gates.json ibms-brain/scripts/verify.sh   # 3, the brain's -- satisfiable"
        " || grep -c gates.json scripts/verify.sh   # 0, THIS repo's -- nothing to read",
    ),
}

_HOOK_PATH = re.compile(r"[\w./-]*hooks/([\w-]+\.sh)")
_SWALLOWS = re.compile(r"\|\|\s*true\s*'?\s*$")


def _registered_in_settings(settings: dict) -> dict:
    """Hook basename -> the commands registering it."""
    found: dict = {}
    for event, groups in (settings.get("hooks") or {}).items():
        for group in groups or []:
            for hook in group.get("hooks") or []:
                cmd = hook.get("command", "")
                for base in dict.fromkeys(_HOOK_PATH.findall(cmd)):
                    found.setdefault(base, []).append(f"{event}: {cmd}")
    return found


def _git_modes(rel: str) -> dict:
    cwd = os.path.join(ROOT, "ibms-brain")
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "ls-files", "-s", rel],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except Exception:  # noqa: BLE001
        return {}
    modes = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            modes[os.path.basename(parts[1])] = parts[0].split()[0]
    return modes


def audit(settings_path: str = SETTINGS, hooks_dir: str = BRAIN_HOOKS) -> tuple:
    errors: list = []
    lines: list = []

    try:
        settings = json.load(open(settings_path, encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return ([f".claude/settings.json does not parse: {exc}"], [])

    live = _registered_in_settings(settings)
    # Only brain hooks are this gate's business; the repo's own mirror hook is not one.
    live = {k: v for k, v in live.items() if k in REGISTERED or k in NOT_REGISTERED}

    # ── 1. the declared set, in BOTH directions ────────────────────────────────
    for base in sorted(set(REGISTERED) - set(live)):
        errors.append(
            f"{base} is DECLARED registered but no registration names it in "
            ".claude/settings.json — the guard is not running"
        )
    for base in sorted(set(live) - set(REGISTERED)):
        why = NOT_REGISTERED.get(base, ("", ""))[0]
        errors.append(
            f"{base} IS registered but is declared NOT registered. Measure what it refuses "
            f"before wiring it, then move it to REGISTERED with the figure. Recorded reason: {why}"
        )

    # ── 2. existence, and 3. the silent shape ─────────────────────────────────
    submodule_present = os.path.isdir(hooks_dir)
    for base, cmds in sorted(live.items()):
        if submodule_present and not os.access(os.path.join(hooks_dir, base), os.R_OK):
            errors.append(
                f"{base} is registered but is missing or unreadable in "
                "ibms-brain/.claude/hooks/"
            )
        for cmd in cmds:
            if _SWALLOWS.search(cmd):
                errors.append(
                    f"{base} is registered with a trailing `|| true` — a missing guard would "
                    "exit 0 and the action would proceed"
                )

    # ── 4. the executable bit as GIT records it ───────────────────────────────
    if submodule_present:
        modes = _git_modes(".claude/hooks")
        for base in sorted(f for f in os.listdir(hooks_dir) if f.endswith(".sh")):
            mode = modes.get(base)
            if mode and mode != "100755":
                errors.append(
                    f"ibms-brain/.claude/hooks/{base} is recorded in git as {mode}, not "
                    "100755 — a fresh clone gets no executable bit and the brain's own "
                    "`[ -x ]` registrations skip it in silence"
                )
    else:
        lines.append("  note   ibms-brain is not checked out; mode and existence checks skipped")

    # ── 5. every NOT_REGISTERED entry carries its disproof ────────────────────
    for base, (why, proof) in sorted(NOT_REGISTERED.items()):
        if not why.strip() or not proof.strip():
            errors.append(
                f"{base} is declared NOT registered without a reason and a proving command"
            )

    on_disk = (
        len([f for f in os.listdir(hooks_dir) if f.endswith(".sh")])
        if submodule_present
        else "n/a"
    )
    lines.append(f"  registered here:     {len(REGISTERED)}")
    lines.append(f"  deliberately not:    {len(NOT_REGISTERED)}")
    lines.append(f"  brain hooks on disk: {on_disk}")
    return errors, lines


def _self_test() -> int:
    """Plant each condition in a throwaway tree; the audit must report it."""
    import shutil
    import tempfile

    made = []

    def tree(cmds, hooks):
        tmp = tempfile.mkdtemp()
        made.append(tmp)
        hd = os.path.join(tmp, "hooks")
        os.makedirs(hd)
        for h in hooks:
            with open(os.path.join(hd, h), "w", encoding="utf-8") as fh:
                fh.write("#!/bin/bash\nexit 0\n")
        sp = os.path.join(tmp, "settings.json")
        with open(sp, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "hooks": {
                        "PreToolUse": [
                            {
                                "matcher": "Bash",
                                "hooks": [
                                    {"type": "command", "command": c} for c in cmds
                                ],
                            }
                        ]
                    }
                },
                fh,
            )
        subprocess.run(["git", "-C", tmp, "init", "-q"], check=False)
        return sp, hd

    def loud(n):
        return f's="hooks/{n}"; if [ -r "$s" ]; then exec bash "$s"; fi; exit 2'

    def quiet(n):
        return f'[ -f "hooks/{n}" ] && exec bash "hooks/{n}" || true'

    all_reg = sorted(REGISTERED)
    cases = []

    sp, hd = tree([loud(n) for n in all_reg], all_reg)
    cases.append(("the declared set, all present and loud", audit(sp, hd)[0], False))

    sp, hd = tree([loud(n) for n in all_reg[1:]], all_reg)
    cases.append(("PLANT one declared hook left unregistered", audit(sp, hd)[0], True))

    extra = sorted(NOT_REGISTERED)[0]
    sp, hd = tree([loud(n) for n in all_reg] + [loud(extra)], all_reg + [extra])
    cases.append(("PLANT a NOT_REGISTERED hook wired anyway", audit(sp, hd)[0], True))

    sp, hd = tree([loud(n) for n in all_reg], all_reg[1:])
    cases.append(("PLANT a registered hook that does not exist", audit(sp, hd)[0], True))

    sp, hd = tree([quiet(n) for n in all_reg], all_reg)
    cases.append(("PLANT the `|| true` shape back", audit(sp, hd)[0], True))

    failures = []
    for name, errs, should in cases:
        got = bool(errs)
        if got != should:
            failures.append(
                f"{name}: expected {'ERROR' if should else 'clean'}, "
                f"got {'ERROR: ' + errs[0][:80] if got else 'clean'}"
            )
        else:
            print(f"  ok     {name}" + (f"  ->  {errs[0][:64]}" if errs else ""))
    for f in failures:
        print(f"  FAIL   {f}")
    print(
        f"\n  hook-registration self-test: {len(cases) - len(failures)}/{len(cases)} correct,"
        f" {len(failures)} failure(s)"
    )
    for t in made:
        shutil.rmtree(t, ignore_errors=True)
    return 1 if failures else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()

    errors, lines = audit()
    print("\n  ibms-brain hook registration\n")
    for line in lines:
        print(line)
    print()
    for base, why in sorted(REGISTERED.items()):
        print(f"  RUNS   {base}\n           {why}\n")
    for base, (why, proof) in sorted(NOT_REGISTERED.items()):
        print(f"  NOT    {base}\n           {why}\n           prove it: {proof}\n")
    for e in errors:
        print(f"  ERROR  {e}")
    if errors:
        print(f"\n  {len(errors)} error(s)\n")
        return 1 if "--check" in sys.argv else 0
    print("  ok     every declared guard is registered, present, executable, and fails loudly\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
