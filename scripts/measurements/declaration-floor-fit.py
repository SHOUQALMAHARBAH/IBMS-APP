#!/usr/bin/env python
"""
THE DECLARATION-REASON FLOOR: ONE RULE, THREE PLACES THAT ENFORCE IT, AND NOTHING KEEPING
THEM EQUAL.

    python scripts/measurements/declaration-floor-fit.py            # report
    python scripts/measurements/declaration-floor-fit.py --check     # gate, both directions
    python scripts/measurements/declaration-floor-fit.py --self-test # prove it can fail

## The rule and where it lives

`apps/api/src/common/declaration-reason.ts` holds `DECLARATION_REASON_MIN_LENGTH = 10` and
opens by calling itself *"ONE HOME FOR THE MINIMUM LENGTH OF A DECLARATION'S WRITTEN REASON"*,
quoting the owner's instruction: *"follow the EXISTING minimum reason length rather than
inventing one... Two different minimums for one concept is the drift we keep paying for."*

Nine files import it. The discipline is real and mostly held. **What nothing checked is the
other two places the same number is enforced.**

## What was measured, 2026-11-07

**(1) THE DATABASE ENFORCES IT IN SQL, WHERE NO IMPORTER CAN REACH.** Two CHECK constraints
hard-code the floor:

    CombinedDutyAct_reason_not_empty             CHECK (length(btrim("reason")) >= 10)
    IncidentContainmentAction_description_not_blank  CHECK (length(btrim("description")) >= 10)

and the second migration's own comment says it outright — *"The floor is the ONE home for a
declaration minimum (`common/declaration-reason.ts`, 10)"*. **A comment in a migration file is
where an enforced rule goes to not be read**: in the owner's words, *"nobody reads it except
whoever already decided to change it."* Lower the constant to 8 and both DTO and database still
disagree by two, and the symptom is a **500 from a CHECK violation where a 400 belongs** —
because the DTO would accept the value the database then refuses.

**(2) THE FILE'S OWN CITED EVIDENCE DOES NOT READ FROM IT.** `declaration-reason.ts` names the
two homes that use ten: `COMBINED_DUTY_REASON_MIN_LENGTH` *"and the commission override's
`reason`"*. Measured: `modules/commission/dto/raise-commission-override.dto.ts` writes a
**literal `@MinLength(10)`** and does not import the constant. So the file that exists to stop
a third `10` being written cites, as proof of its own rule, a site that is a second `10`.
Corrected by pointing it at the constant — which is executing that file's stated intent, not a
new decision.

**(3) TWO MORE LITERAL TENS ARE NOT CLASSIFIED AND ARE NOT TOUCHED.**
`customer-service/dto/resolve-complaint.dto.ts:14` and
`finance/dto/resolve-reconciliation.dto.ts:18` both write `@MinLength(10)`.
`declaration-reason.ts` classifies the three-character minimums as *notes rather than
declarations* and names only two ten-character homes — it says nothing about these two.
**Whether a complaint resolution and a reconciliation resolution are declarations is a product
question, not a refactor**, so they are listed in `UNCLASSIFIED` below with the question
recorded rather than answered by a sweep.

## What this gate asserts

1. Every `length(btrim(...)) >= N` CHECK with `N > 1` in the migrations equals the constant,
   and the set of such constraints matches `DB_FLOORS` **in both directions** — a new one
   appearing is the event this exists to catch.
2. Every `@MinLength(N)` in a DTO where `N` equals the constant either imports the constant or
   is named in `UNCLASSIFIED` with a reason.

Both passes TOKENISE. The SQL reader strips `--` and `/* */` and leaves string bodies out of
scope; the TypeScript reader is `blank_comments` from `page-wide-absence-assertions.py`, reused
rather than copied, because a second comment-stripper in this repository is how a figure moved
by four in the direction that looked like progress.
"""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONST_FILE = os.path.join(ROOT, "apps", "api", "src", "common", "declaration-reason.ts")
MIGRATIONS = os.path.join(ROOT, "packages", "db", "prisma", "migrations")
API_SRC = os.path.join(ROOT, "apps", "api", "src")

#: Every database CHECK that enforces the declaration floor, as (table, column).
#: Declared so a NEW one fails here rather than quietly becoming a third copy of the number.
DB_FLOORS = {
    ("CombinedDutyAct", "reason"),
    ("IncidentContainmentAction", "description"),
}

#: Literal `@MinLength(10)` sites that do NOT import the constant and are deliberately left
#: alone, because whether they are declarations is the owner's call rather than a refactor.
UNCLASSIFIED = {
    "modules/customer-service/dto/resolve-complaint.dto.ts": (
        "A complaint resolution note. `declaration-reason.ts` names only two ten-character "
        "homes and does not classify this one. If it is a declaration, point it at the "
        "constant; if it is a note, the three-character shape applies and 10 is the wrong "
        "number. Either way it is a decision."
    ),
    "modules/finance/dto/resolve-reconciliation.dto.ts": (
        "A reconciliation resolution note. Same question as the complaint above, and the lex "
        "money-decimal-jod.md § Rationale makes this one sharper: a reconciliation mismatch "
        "must be raised as an exception and never written off, so the reason attached to "
        "resolving one may well be a declaration."
    ),
    "modules/recommendation/dto/draft-recommendation.dto.ts": (
        "The broker's `rationale` for a recommendation (10..8000). FOUND BY THIS SCRIPT AND "
        "NOT BY HAND, and it is the reason the gate was worth building: "
        "`declaration-reason.ts` says its figure was 'MEASURED across every reason-bearing "
        "field in the api' — and this field is named `rationale`, not `reason`, so a "
        "reason-scoped sweep could not see it. Whether a recommendation rationale is a "
        "declaration is the owner's call; it is the same SHAPE (a written justification "
        "attached to an act, logged verbatim) under a different noun."
    ),
}


def _load_blank_comments():
    """`blank_comments` from the page-wide-absence gate — imported, never copied.

    That module's own docstring records why: its first version was two regex substitutions
    that ate `//` inside string literals and truncated real code at every `http://` URL. The
    corrected walker is the repository's one home for reading TypeScript as code.
    """
    path = os.path.join(ROOT, "scripts", "measurements", "page-wide-absence-assertions.py")
    spec = importlib.util.spec_from_file_location("pwa", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["pwa"] = mod
    spec.loader.exec_module(mod)
    return mod.blank_comments


def blank_sql_comments(src: str) -> str:
    """SQL with `--` and `/* */` comment bodies replaced by spaces, offsets preserved.

    SQL's line comment is `--`, not `//`, so the TypeScript walker cannot be reused here —
    and a migration file is mostly prose: every floor in this repository is explained in a
    comment directly above the constraint that enforces it, usually quoting the number. A
    reader that cannot tell the two apart counts the explanation as an instance.

    Single-quoted string bodies are blanked too, so a seeded value containing `--` does not
    open a comment.
    """
    out = []
    i, n = 0, len(src)
    NEWLINE = chr(10)
    while i < n:
        c = src[i]
        if c == "'":
            out.append(c)
            i += 1
            while i < n:
                # SQL escapes a quote by doubling it.
                if src[i] == "'" and i + 1 < n and src[i + 1] == "'":
                    out.append("  ")
                    i += 2
                    continue
                if src[i] == "'":
                    out.append("'")
                    i += 1
                    break
                out.append(" " if src[i] != NEWLINE else NEWLINE)
                i += 1
            continue
        if c == "-" and i + 1 < n and src[i + 1] == "-":
            while i < n and src[i] != NEWLINE:
                out.append(" ")
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            while i < end:
                out.append(" " if src[i] != NEWLINE else NEWLINE)
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


_CONST = re.compile(r"DECLARATION_REASON_MIN_LENGTH\s*=\s*(\d+)")
_CHECK = re.compile(
    r'CHECK\s*\(\s*length\s*\(\s*btrim\s*\(\s*"(?P<col>\w+)"\s*\)\s*\)\s*(?P<op>>=|>)\s*(?P<n>\d+)'
)
_ALTER = re.compile(r'ALTER\s+TABLE\s+"(?P<table>\w+)"', re.IGNORECASE)
_MINLEN = re.compile(r"@MinLength\(\s*(\d+)\s*\)")


def constant_value() -> int:
    m = _CONST.search(open(CONST_FILE, encoding="utf-8").read())
    if not m:
        raise SystemExit("declaration-reason.ts does not declare DECLARATION_REASON_MIN_LENGTH")
    return int(m.group(1))


def db_floors(migrations_dir: str = MIGRATIONS) -> list:
    """(table, column, floor, file) for every length CHECK with a floor above 1."""
    found = []
    for dirpath, _dirs, files in os.walk(migrations_dir):
        for fn in files:
            if not fn.endswith(".sql"):
                continue
            path = os.path.join(dirpath, fn)
            code = blank_sql_comments(open(path, encoding="utf-8").read())
            for m in _CHECK.finditer(code):
                n = int(m.group("n"))
                if m.group("op") == ">" and n <= 1:
                    continue  # `> 0` is "not blank", a different rule
                if n <= 1:
                    continue
                before = code[: m.start()]
                tables = _ALTER.findall(before)
                table = tables[-1] if tables else "?"
                found.append((table, m.group("col"), n, os.path.relpath(path, ROOT)))
    return found


def literal_minlength_sites(floor: int, api_src: str = API_SRC) -> list:
    """(relpath, line, imports_constant) for every `@MinLength(floor)` in a DTO."""
    blank_comments = _load_blank_comments()
    out = []
    for dirpath, _dirs, files in os.walk(api_src):
        for fn in files:
            if not fn.endswith(".dto.ts"):
                continue
            path = os.path.join(dirpath, fn)
            text = open(path, encoding="utf-8").read()
            code = blank_comments(text)
            if not any(int(n) == floor for n in _MINLEN.findall(code)):
                continue
            rel = os.path.relpath(path, api_src).replace(os.sep, "/")
            imports = "declaration-reason" in code
            line = next(
                (
                    i
                    for i, l in enumerate(code.splitlines(), 1)
                    if _MINLEN.search(l) and int(_MINLEN.search(l).group(1)) == floor
                ),
                0,
            )
            out.append((rel, line, imports))
    return out


def audit() -> tuple:
    errors, lines = [], []
    floor = constant_value()
    lines.append(f"  DECLARATION_REASON_MIN_LENGTH = {floor}   (apps/api/src/common/declaration-reason.ts)")

    found = db_floors()
    lines.append(f"  database CHECK floors above 1: {len(found)}")
    seen = set()
    for table, col, n, path in sorted(found):
        seen.add((table, col))
        mark = "ok " if n == floor else "BAD"
        lines.append(f"    {mark} {table}.{col} >= {n}   {path}")
        if n != floor:
            errors.append(
                f"{table}.{col} enforces a floor of {n} in SQL while "
                f"DECLARATION_REASON_MIN_LENGTH is {floor} — a DTO that accepts {floor} "
                f"characters would produce a 500 from the CHECK where a 400 belongs"
            )
    for missing in sorted(DB_FLOORS - seen):
        errors.append(
            f"{missing[0]}.{missing[1]} is DECLARED as a declaration floor but no CHECK was "
            "found — was the constraint dropped?"
        )
    for extra in sorted(seen - DB_FLOORS):
        errors.append(
            f"{extra[0]}.{extra[1]} enforces a length floor in SQL and is not declared in "
            "DB_FLOORS. If it is a declaration reason, add it; if not, it is a second number "
            "for a different concept and needs its own home"
        )

    sites = literal_minlength_sites(floor)
    lines.append(f"  DTOs with @MinLength({floor}): {len(sites)}")
    for rel, line, imports in sorted(sites):
        if imports:
            lines.append(f"    ok  {rel}:{line}   imports the constant")
        elif rel in UNCLASSIFIED:
            lines.append(f"    --  {rel}:{line}   literal, unclassified by decision")
        else:
            lines.append(f"    BAD {rel}:{line}   literal {floor}, no import")
            errors.append(
                f"{rel}:{line} writes a literal {floor} without importing "
                "DECLARATION_REASON_MIN_LENGTH. That constant exists because two statements "
                "of one minimum is the drift this repo keeps paying for — import it, or add "
                "this file to UNCLASSIFIED with the reason it is not a declaration"
            )
    return errors, lines


def _self_test() -> int:
    """Planted inputs, including the string-literal and comment shapes."""
    cases = []

    sql_comment = (
        '-- CHECK (length(btrim("reason")) >= 99) was the old floor\n'
        'ALTER TABLE "T" ADD CONSTRAINT c CHECK (length(btrim("reason")) >= 10);\n'
    )
    got = [n for _t, _c, n, _p in _floors_from_text(sql_comment)]
    cases.append(("a commented-out CHECK is not a floor", got == [10], got))

    sql_string = (
        "INSERT INTO t VALUES ('-- not a comment');\n"
        'ALTER TABLE "T" ADD CONSTRAINT c CHECK (length(btrim("x")) >= 10);\n'
    )
    got = [n for _t, _c, n, _p in _floors_from_text(sql_string)]
    cases.append(("a `--` inside a SQL string does not open a comment", got == [10], got))

    sql_block = (
        '/* CHECK (length(btrim("reason")) >= 77) */\n'
        'ALTER TABLE "T" ADD CONSTRAINT c CHECK (length(btrim("y")) >= 10);\n'
    )
    got = [n for _t, _c, n, _p in _floors_from_text(sql_block)]
    cases.append(("a block-commented CHECK is not a floor", got == [10], got))

    sql_not_blank = 'ALTER TABLE "T" ADD CONSTRAINT c CHECK (length(btrim("n")) > 0);\n'
    got = [n for _t, _c, n, _p in _floors_from_text(sql_not_blank)]
    cases.append(("`> 0` is not-blank, a different rule, and is excluded", got == [], got))

    sql_table = 'ALTER TABLE "Widget" ADD CONSTRAINT c CHECK (length(btrim("reason")) >= 10);\n'
    got = [t for t, _c, _n, _p in _floors_from_text(sql_table)]
    cases.append(("the table name is resolved from the ALTER above", got == ["Widget"], got))

    failures = []
    for name, ok, got in cases:
        if ok:
            print(f"  ok     {name}")
        else:
            failures.append(f"{name}: got {got!r}")
    for f in failures:
        print(f"  FAIL   {f}")
    print(
        f"\n  declaration-floor-fit self-test: {len(cases) - len(failures)}/{len(cases)} correct,"
        f" {len(failures)} failure(s)"
    )
    return 1 if failures else 0


def _floors_from_text(sql: str) -> list:
    """`db_floors` over a literal string — the self-test's seam."""
    code = blank_sql_comments(sql)
    out = []
    for m in _CHECK.finditer(code):
        n = int(m.group("n"))
        if n <= 1:
            continue
        tables = _ALTER.findall(code[: m.start()])
        out.append((tables[-1] if tables else "?", m.group("col"), n, "<literal>"))
    return out


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()
    errors, lines = audit()
    print("\n  declaration-reason floor fit\n")
    for line in lines:
        print(line)
    print()
    for base, why in sorted(UNCLASSIFIED.items()):
        print(f"  OWNER'S CALL  {base}\n                  {why}\n")
    for e in errors:
        print(f"  ERROR  {e}")
    if errors:
        print(f"\n  {len(errors)} error(s)\n")
        return 1 if "--check" in sys.argv else 0
    print("  ok     one floor, and every place that enforces it agrees\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
