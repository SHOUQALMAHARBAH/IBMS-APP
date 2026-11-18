#!/usr/bin/env python
"""
A PASSWORD A SEED SCRIPT ASSIGNS MUST NOT BE PRINTED IN `docs/first-run.md`.

    python scripts/measurements/seed-password-in-docs.py             # report
    python scripts/measurements/seed-password-in-docs.py --check      # gate, both directions
    python scripts/measurements/seed-password-in-docs.py --self-test  # prove it can fail

## Why this exists

`docs/first-run.md` is the document handed to somebody who does not read code -- the owner,
a presenter, whoever is shown the system first. Until 2026-11-18 it printed, in both language
halves, the shared password of the eleven `sample.` accounts, in a code span, twice.

A password written in a file stopped being a secret the moment it was written there. The guide
says exactly that about the demo password, in its own §2 -- *"Do not use the password written
in the requirements document"* -- and then printed a different one four hundred lines further
down. A rule a document states and breaks about itself is worse than one it never states,
because a reader who has met §2 has no reason to doubt §7.

So this is budget ZERO on `docs/first-run.md`. There is no correct instance: a guide that needs
to say WHICH password can say where it is SET, by variable name and file, which is what it does
now and what a reader can actually act on.

## What it reads, and why it is derived rather than listed

The secrets are not a list in this file -- a list is a second copy of the thing it is guarding,
and this script would then be the fourth place that password lives. They are DERIVED: every
string literal a seed script assigns to a variable whose name contains `password`, in any case.
Measured 2026-11-18, that is exactly one (`SAMPLE_USER_PASSWORD`), and the expected count is
asserted below so the derivation cannot quietly start matching nothing.

🔴 A BUDGET-ZERO GATE THAT MATCHES NOTHING PRINTS A CONFIDENT GREEN OVER ITS OWN SUBJECT, and
this repository has already shipped that once -- `check:process-prefix` reported ZERO with the
defect planted in front of it, because it read one line and the real string was wrapped. Hence
`EXPECTED_SECRET_COUNT`: if the derivation stops finding the password, the gate FAILS rather
than passing, and says which direction it failed in.

## The second file is REPORTED, not hidden, and the report is asserted

Measured 2026-11-18, the same literal is also in `docs/phase-2-walkthrough.md`, four times.
Message 46 §1.1 asked for that to be REPORTED by file -- it did not ask for it to be changed --
so it is declared below rather than fixed, and the declaration is checked in BOTH directions:

  * a declared file that no longer holds the literal is STALE and fails, so the day somebody
    cleans it up this declaration is removed rather than quietly outliving its reason;
  * a file OUTSIDE the declaration and outside the seed that holds it fails BY NAME, which is
    the real job -- a new document that prints it cannot ship green.

⛔ `docs/first-run.md` may never enter that declaration. It is the subject of the gate, and a
subject that can be declared away is not a subject. That is asserted too.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

# This gate runs inside `npm run check:docs`, so it may not depend on the console codepage --
# the recorded cp1252 failure, which is green in CI and broken locally, the worst direction.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The document this gate is ABOUT. Budget zero, no exception possible.
SUBJECT = "docs/first-run.md"

# Where a seeded credential may legitimately be a literal: the script that sets it.
SEED_PREFIXES = ("packages/db/prisma/", "apps/api/scripts/")

# `const NAME = 'literal'`, where NAME contains `password` in any case and the literal is long
# enough to be one. The six-character floor keeps `password: ''` and format strings out.
ASSIGN = re.compile(
    r"(?:const|let|var)\s+([A-Za-z_$][\w$]*[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd][\w$]*)\s*"
    r"(?::\s*[^=\n]+)?=\s*(['\"`])([^'\"`\n]{6,})\2"
)

# Measured 2026-11-18: exactly one. Asserted so a derivation that stops matching FAILS.
EXPECTED_SECRET_COUNT = 1

# Files outside the seed that hold a seeded password literal, DECLARED with its count and
# checked in both directions. Message 46 §1.1 asked for this to be reported by file.
REPORTED_ELSEWHERE: dict[str, int] = {
    "docs/phase-2-walkthrough.md": 4,
}



def _tracked(root: str) -> list[str]:
    """Repo-relative paths.

    `git ls-files` where there is a repository, a plain walk where there is not.

    ⛔ THE SELF-TEST BUILDS A TREE AND DOES NOT `git init` IT, DELIBERATELY. `check:bilingual-names`
    did, and on this host `git init` fails intermittently with `cygheap read copy failed ... Win32
    error 299` -- exit 1 on three runs in five while printing `8 of 8 passed`. A gate whose
    self-test flakes for a reason unrelated to what it measures teaches people to re-run it until
    it is green, which is the opposite of a gate.
    """
    if os.path.isdir(os.path.join(root, ".git")):
        out = subprocess.run(["git", "ls-files"], cwd=root,
                             capture_output=True, text=True, check=True).stdout
        return [f for f in out.split("\n") if f.strip()]
    found: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
        for name in filenames:
            full = os.path.join(dirpath, name)
            found.append(os.path.relpath(full, root).replace(os.sep, "/"))
    return sorted(found)


def _read(root: str, rel: str) -> str | None:
    try:
        with open(os.path.join(root, rel), "rb") as fh:
            return fh.read().decode("utf-8")
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError, PermissionError):
        return None


def audit(root: str = ROOT) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    lines: list[str] = []
    files = _tracked(root)

    # ⛔ The subject may never be declared away. A subject that can be moved onto the exception
    # list is not a subject, and this is REPORTED rather than asserted: a traceback inside
    # `npm run check:docs` tells a reader the gate is broken when what is broken is the
    # declaration, which is a different thing with a different fix.
    if SUBJECT in REPORTED_ELSEWHERE:
        errors.append(
            f"{SUBJECT} is the SUBJECT of this gate and may never be declared in "
            f"REPORTED_ELSEWHERE -- take the password out of it instead"
        )
        return errors, lines

    # ---- derive the secrets from the seed scripts -------------------------------------
    secrets: dict[str, tuple[str, int]] = {}      # value -> (declaring file, line)
    for rel in files:
        if not rel.startswith(SEED_PREFIXES) or not rel.endswith(".ts"):
            continue
        body = _read(root, rel)
        if body is None:
            continue
        for m in ASSIGN.finditer(body):
            secrets[m.group(3)] = (rel, body[:m.start()].count("\n") + 1)

    lines.append("")
    lines.append("  a seeded password printed in the first-run guide")
    lines.append("")
    lines.append(f"  password literals assigned in seed scripts   {len(secrets)}")
    for value, (rel, line) in sorted(secrets.items(), key=lambda kv: kv[1]):
        # ⛔ THE VALUE IS NEVER PRINTED. Only where it is set, and how long it is.
        lines.append(f"    set at {rel}:{line}  ({len(value)} chars)")

    if len(secrets) != EXPECTED_SECRET_COUNT:
        errors.append(
            f"the derivation found {len(secrets)} password literal(s) in the seed scripts and "
            f"EXPECTED_SECRET_COUNT says {EXPECTED_SECRET_COUNT} -- if a password was removed, "
            f"lower the figure; if the pattern stopped matching one, this gate is checking "
            f"nothing and must not report green"
        )
        return errors, lines

    # ---- budget zero on the subject ---------------------------------------------------
    subject_body = _read(root, SUBJECT)
    if subject_body is None:
        errors.append(f"{SUBJECT} is missing -- this gate has no subject")
        return errors, lines

    hits = 0
    for value, (rel, line) in secrets.items():
        n = subject_body.count(value)
        if n:
            hits += n
            errors.append(
                f"{SUBJECT} prints the password set at {rel}:{line} -- {n} occurrence(s). "
                f"Say WHERE it is set (the variable name and the file), never what it is: a "
                f"password written in a document stopped being a secret when it was written"
            )
    lines.append(f"  occurrences in {SUBJECT}                 {hits}   budget 0")

    # ---- the declared report, both directions -----------------------------------------
    elsewhere: dict[str, int] = {}
    for rel in files:
        if rel == SUBJECT or rel.startswith(SEED_PREFIXES):
            continue
        body = _read(root, rel)
        if body is None:
            continue
        n = sum(body.count(v) for v in secrets)
        if n:
            elsewhere[rel] = n

    for rel, n in sorted(elsewhere.items()):
        if rel not in REPORTED_ELSEWHERE:
            errors.append(
                f"{rel} holds a seeded password literal ({n} occurrence(s)) and is not "
                f"declared in REPORTED_ELSEWHERE -- either take it out of that file, or "
                f"declare it with its count and the reason it is still there"
            )
        elif REPORTED_ELSEWHERE[rel] != n:
            errors.append(
                f"{rel} holds {n} occurrence(s) and REPORTED_ELSEWHERE declares "
                f"{REPORTED_ELSEWHERE[rel]} -- that declaration is stale"
            )
    for rel in sorted(REPORTED_ELSEWHERE):
        if rel not in elsewhere:
            errors.append(
                f"REPORTED_ELSEWHERE declares {rel}, which no longer holds a seeded password "
                f"literal -- the declaration is stale and should be removed, which is what it "
                f"is for"
            )

    lines.append(f"  declared elsewhere, each asserted          {len(REPORTED_ELSEWHERE)}")
    for rel in sorted(REPORTED_ELSEWHERE):
        lines.append(f"    reported, not in this gate's scope: {rel} "
                     f"({REPORTED_ELSEWHERE[rel]} occurrence(s))")
    return errors, lines


# ---------------------------------------------------------------------------------------
# SELF-TEST -- a synthetic tree, no `git init`, no real secret.
# ---------------------------------------------------------------------------------------
def _build(tmp: str, guide_prints: bool = False, extra: dict[str, str] | None = None,
           seed_literal: str | None = "Sample-Pa55word!") -> None:
    os.makedirs(os.path.join(tmp, "packages", "db", "prisma", "seed-data"), exist_ok=True)
    os.makedirs(os.path.join(tmp, "docs"), exist_ok=True)
    seed = "export const SAMPLE_USER_PASSWORD = 'LITERAL';\n"
    seed = (seed.replace("LITERAL", seed_literal) if seed_literal
            else "export const NOTHING_HERE = 1;\n")
    with open(os.path.join(tmp, "packages", "db", "prisma", "seed-data", "sample-users.ts"),
              "wb") as fh:
        fh.write(seed.encode())
    guide = "# First run\n\nSign in with the sample accounts.\n"
    if guide_prints and seed_literal:
        guide += "\nTheir shared password is `" + seed_literal + "`.\n"
    with open(os.path.join(tmp, "docs", "first-run.md"), "wb") as fh:
        fh.write(guide.encode())
    for rel, body in (extra or {}).items():
        full = os.path.join(tmp, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as fh:
            fh.write(body.encode())


def _self_test() -> int:
    import tempfile

    LIT = "Sample-Pa55word!"
    declared_before = dict(REPORTED_ELSEWHERE)
    cases = [
        ("a clean tree",
         lambda t: (_build(t), REPORTED_ELSEWHERE.clear()),
         None),
        ("the guide prints the seeded password",
         lambda t: (_build(t, guide_prints=True), REPORTED_ELSEWHERE.clear()),
         "prints the password set at"),
        ("the guide prints it inside a code fence -- still a finding",
         lambda t: (_build(t, extra={"docs/first-run.md":
                                     "# First run\n\n```\n" + LIT + "\n```\n"}),
                    REPORTED_ELSEWHERE.clear()),
         "prints the password set at"),
        ("ANOTHER tracked document prints it, undeclared",
         lambda t: (_build(t, extra={"docs/walkthrough.md": "password: " + LIT + "\n"}),
                    REPORTED_ELSEWHERE.clear()),
         "is not declared in REPORTED_ELSEWHERE"),
        ("a declared file that no longer holds it -- the declaration is stale",
         lambda t: (_build(t), REPORTED_ELSEWHERE.clear(),
                    REPORTED_ELSEWHERE.__setitem__("docs/gone.md", 1)),
         "the declaration is stale"),
        ("a declared file whose COUNT has moved",
         lambda t: (_build(t, extra={"docs/walkthrough.md": LIT + "\n" + LIT + "\n"}),
                    REPORTED_ELSEWHERE.clear(),
                    REPORTED_ELSEWHERE.__setitem__("docs/walkthrough.md", 1)),
         "that declaration is stale"),
        # 🔴 THE NON-VACUITY FLOOR. Without this a pattern that silently stops matching turns
        # the gate into a green light over its own subject -- the recorded `check:process-prefix`
        # failure, which reported ZERO with the defect planted in front of it.
        ("the derivation stops finding any password at all",
         lambda t: (_build(t, seed_literal=None), REPORTED_ELSEWHERE.clear()),
         "must not report green"),
        ("the subject is missing",
         lambda t: (_build(t), REPORTED_ELSEWHERE.clear(),
                    os.remove(os.path.join(t, "docs", "first-run.md"))),
         "has no subject"),
        # ⛔ The subject declared away -- the one shape that would turn this gate into an
        # amnesty for the exact document it exists to protect.
        ("the SUBJECT itself is declared as an exception",
         lambda t: (_build(t, guide_prints=True), REPORTED_ELSEWHERE.clear(),
                    REPORTED_ELSEWHERE.__setitem__(SUBJECT, 1)),
         "may never be declared in REPORTED_ELSEWHERE"),
    ]

    passed = failed = 0
    print()
    print("  self-test")
    print()
    try:
        for label, mutate, needle in cases:
            tmp = tempfile.mkdtemp(prefix="seed-pw-")
            try:
                mutate(tmp)
                errors, _ = audit(tmp)
                if needle is None:
                    ok = not errors
                    got = "clean" if ok else errors[0][:70]
                else:
                    ok = any(needle in e for e in errors)
                    got = "named it" if ok else (errors[0][:70] if errors else "NO ERROR")
                print(f"  {'ok  ' if ok else 'FAIL'}  {label:<62} {got}")
                passed += ok
                failed += not ok
            finally:
                import shutil
                shutil.rmtree(tmp, ignore_errors=True)
                REPORTED_ELSEWHERE.clear()
                REPORTED_ELSEWHERE.update(declared_before)
    finally:
        REPORTED_ELSEWHERE.clear()
        REPORTED_ELSEWHERE.update(declared_before)
    assert REPORTED_ELSEWHERE == declared_before, "the self-test left the declaration mutated"
    print()
    print(f"  self-test: {passed} passed, {failed} failed")
    print()
    return 1 if failed else 0


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()
    errors, lines = audit()
    print("\n".join(lines))
    print()
    for e in errors:
        print(f"  ERROR  {e}")
    if errors:
        print(f"\n  {len(errors)} error(s)\n")
        return 1 if "--check" in sys.argv else 0
    print("  OK: the first-run guide prints no password a seed script assigns.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
