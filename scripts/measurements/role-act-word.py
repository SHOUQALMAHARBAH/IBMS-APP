#!/usr/bin/env python
"""NO ARABIC `role*` STRING SAYS «تقاعد» — OWNER DECISION 156 RULING 3.

    python scripts/measurements/role-act-word.py             # report
    python scripts/measurements/role-act-word.py --check      # gate, budget zero
    python scripts/measurements/role-act-word.py --self-test  # prove it can fail

## Her ruling, and why the budget is ZERO rather than a ratchet

Decision 156 ruling 3-أ and its continuation: the word for the act on the roles screen is
**«تعطيل»**, which is the word already on three buttons that do the same thing — `usrDeactivate`,
`orgUnitRetire` and `slapDeactivate`. Four strings carried «تقاعد»:

    roleVerbDeactivate   تقاعد          ->  تعطيل
    roleStatusInactive   متقاعد         ->  معطّل
    roleSystemExplain    ولا تقاعده     ->  ولا تعطيله
    roleRetireButton     تقاعد الدور    ->  تعطيل الدور

So there is no correct instance, and a ratchet would only record how long the next one survived.
The defect this prevents is the one her continuation was written to close: changing the matrix
verb alone left the screen reading «أدوار المكتب · تعطيل» in the table and «تقاعد الدور» on the
button beside it — one act, two words, on one screen.

## ⛔ WHY THE SUBJECT IS THE KEY PREFIX AND NOT THE WORD

«متقاعد» is a perfectly good Arabic word and this repository ships it deliberately:
`secKeysRetired` says «متقاعد — يفكّ تشفير الصفوف القديمة فقط» about an ENCRYPTION KEY, and the
description of `encryption-key.read` says the same. Her own paper rules those out by name:
«و«متقاعد» لمفتاح التشفير … معنى آخر، ولا يدخل».

A gate keyed on the WORD would demand those be changed and would be wrong. A gate keyed on the
KEY PREFIX asks the question her ruling actually asks — *does a string about a ROLE use the
retirement word?* — and is silent about every other subject. That is why `secKeysRetired` is not
an exemption here: it is not in the subject at all, and an exemption list would invite the next
reader to add one.

## Scope, stated rather than assumed

**The AR half of `apps/web/lib/i18n/translations/operations.ts`**, which is where every `role*`
key lives — measured: no other dictionary file defines one. The EN half is NOT scanned: decision
156 says so in its own words («والنصف الإنجليزي … لم يُحكَم فيه؛ لجلسة التنسيق»), and a gate that
read it would be enforcing a ruling nobody has made.
"""
import os
import re
import subprocess
import sys

# This gate PRINTS ARABIC, and Windows hands Python a cp1252 stdout which raises
# UnicodeEncodeError on the first Arabic character. CI is Linux and defaults to UTF-8, so the
# crash appears ONLY on the machine the gate is developed on — green in CI, broken locally,
# which is the worst direction. Same device as `eastern-digits.py`.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web", "lib", "i18n", "translations", "operations.ts")

#: The retirement root. «تقاعد» and «متقاعد» share it, so one needle finds both.
RETIRE = "تقاعد"

#: A dictionary entry: `key: 'value'`, however prettier wrapped it.
ENTRY = re.compile(r"^\s*(role[A-Za-z0-9]*)\s*:\s*\n?\s*'((?:[^'\\]|\\.)*)'", re.M)


def _read(root: str) -> str:
    path = os.path.join(root, SCANNED)
    if not os.path.exists(path):
        return ""
    with open(path, "rb") as fh:
        return fh.read().decode("utf-8")


def _ar_span(body: str):
    """(start, end) of the `AR: { ... }` block, or None.

    ⚠️ BRACE-COUNTED RATHER THAN REGEXED, for `eastern-digits.py`'s recorded reason: a lazy
    `AR:\\s*\\{(.*?)\\}` stops at the first inner closing brace and would scan a fraction of the
    file while reporting a confident zero over the rest of it.
    """
    m = re.search(r"\n  AR:\s*\{", body)
    if not m:
        return None
    i = m.end() - 1
    depth = 0
    for j in range(i, len(body)):
        if body[j] == "{":
            depth += 1
        elif body[j] == "}":
            depth -= 1
            if depth == 0:
                return (i, j + 1)
    return None


def _strip_comments(body: str) -> str:
    """Blank out `/* ... */` and `// ...`, KEEPING EVERY NEWLINE.

    🔴 BOTH FORMS, AND THE NEWLINES. This repository has now found the
    comment-quotes-the-pattern blindness nine times, twice inside the sentence warning about it —
    and the comment directly above `roleVerbDeactivate` in the scanned file explains this very
    ruling while quoting the word it forbids. Deleting comment bodies without their newlines
    collapses line numbering and reports real findings at the wrong line, which is the recorded
    `check:bilingual-names` defect.
    """
    out = []
    i = 0
    n = len(body)
    while i < n:
        two = body[i:i + 2]
        if two == "/*":
            j = body.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in body[i:j]))
            i = j
        elif two == "//":
            j = body.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif body[i] in "'\"":
            # Walk the literal so a `//` or `/*` INSIDE a string is not read as a comment.
            q = body[i]
            j = i + 1
            while j < n and body[j] != q:
                j += 2 if body[j] == "\\" else 1
            j = min(j + 1, n)
            out.append(body[i:j])
            i = j
        else:
            out.append(body[i])
            i += 1
    return "".join(out)


def findings(root: str):
    """Every AR `role*` entry whose value carries the retirement root."""
    body = _read(root)
    if not body:
        return []
    clean = _strip_comments(body)
    span = _ar_span(clean)
    if span is None:
        return []
    start, end = span
    out = []
    for m in ENTRY.finditer(clean, start, end):
        if RETIRE in m.group(2):
            line = clean.count("\n", 0, m.start(1)) + 1
            out.append((line, m.group(1), m.group(2)))
    return out


def _scanned_entries(root: str) -> int:
    """How many AR `role*` entries were actually examined.

    🔴 THE NON-VACUITY HALF. A budget-zero gate that matches NOTHING prints a confident green
    over its own subject, which this repository shipped once in `check:process-prefix`. If the
    file moves, the AR block is renamed, or the entry pattern stops matching, this falls to zero
    and `--check` FAILS instead of passing.
    """
    body = _read(root)
    if not body:
        return 0
    clean = _strip_comments(body)
    span = _ar_span(clean)
    if span is None:
        return 0
    return len(list(ENTRY.finditer(clean, span[0], span[1])))


#: Measured on the tree this gate shipped against. A floor, not an equality: adding a `role*`
#: string is ordinary work and must not fail this.
MIN_ENTRIES = 50


def report(root: str) -> int:
    found = findings(root)
    scanned = _scanned_entries(root)
    print()
    print("  the act word on the roles screen — decision 156 ruling 3")
    print()
    print("  AR `role*` entries examined   %d  (floor %d)" % (scanned, MIN_ENTRIES))
    print("  entries carrying «%s»       %d  (budget 0)" % (RETIRE, len(found)))
    print()
    for line, key, value in found:
        print("  %s:%d" % (SCANNED.replace(os.sep, "/"), line))
        print("      %s: %s" % (key, value[:90]))
    return len(found)


def check(root: str) -> int:
    found = findings(root)
    scanned = _scanned_entries(root)
    if scanned < MIN_ENTRIES:
        print(
            "\nrole-act-word: FAILED — only %d AR `role*` entries were examined, below the floor "
            "of %d.\nThe gate has gone BLIND: %s moved, its `AR:` block was renamed, or the entry "
            "shape changed.\nA budget-zero gate that matches nothing prints a green over its own "
            "subject.\n" % (scanned, MIN_ENTRIES, SCANNED.replace(os.sep, "/"))
        )
        return 1
    if found:
        report(root)
        print(
            "\nrole-act-word: FAILED — %d Arabic `role*` string(s) say «%s» against a budget of 0.\n"
            "OWNER DECISION 156 ruling 3: the word for this act is «تعطيل», and «معطّل» for the "
            "state.\n⛔ Do not raise the budget, and ⛔ do not change `secKeysRetired` or the "
            "description of `encryption-key.read` to match — a retired KEY is a different thing "
            "and her paper says so.\n" % (len(found), RETIRE)
        )
        return 1
    print(
        "\nrole-act-word: OK — 0 of %d Arabic `role*` entries say «%s»." % (scanned, RETIRE)
    )
    return 0


# --------------------------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------------------------
import shutil  # noqa: E402
import tempfile  # noqa: E402

HEADER = "export const OPERATIONS = {\n  AR: {\n"
FOOTER = "  },\n  EN: {\n    roleVerbDeactivate: 'Retire',\n  },\n} as const;\n"


def _tree(entries: str, footer: str = FOOTER) -> str:
    """A synthetic repo. ⛔ It does NOT `git init` — the recorded `Win32 error 299` flake on
    this host, which once exited 1 on three runs in five while printing 8 of 8 passed."""
    root = tempfile.mkdtemp(prefix="role-act-word-")
    path = os.path.join(root, SCANNED)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write((HEADER + entries + footer).encode("utf-8"))
    return root


def _filler(n: int) -> str:
    return "".join("    roleFiller%d: 'نص عربي',\n" % i for i in range(n))


def self_test() -> int:
    cases = []

    def case(name, entries, expect_findings, footer=FOOTER):
        root = _tree(entries, footer)
        try:
            got = len(findings(root))
            ok = got == expect_findings
            cases.append((name, ok, "%d finding(s), expected %d" % (got, expect_findings)))
        finally:
            shutil.rmtree(root, ignore_errors=True)

    pad = _filler(60)

    case("a clean tree reports nothing",
         pad + "    roleVerbDeactivate: 'تعطيل',\n", 0)
    case("the verb back to «تقاعد» is caught",
         pad + "    roleVerbDeactivate: 'تقاعد',\n", 1)
    case("«متقاعد» in a role STATE is caught (same root)",
         pad + "    roleStatusInactive: 'متقاعد',\n", 1)
    case("the word MID-SENTENCE is caught, not only as a whole value",
         pad + "    roleSystemExplain: 'لا يمكن تغيير اسمه ولا تقاعده ولا تعديل صلاحياته.',\n", 1)
    case("a WRAPPED entry is caught — prettier wraps long values onto the next line",
         pad + "    roleRetireButton:\n      'تقاعد الدور',\n", 1)
    case("all four at once are all reported",
         pad
         + "    roleVerbDeactivate: 'تقاعد',\n"
         + "    roleStatusInactive: 'متقاعد',\n"
         + "    roleRetireButton: 'تقاعد الدور',\n"
         + "    roleSystemExplain: 'ولا تقاعده',\n", 4)
    # ⛔ THE THREE NON-FINDINGS, which are what keep the matcher honest.
    case("⛔ a retired ENCRYPTION KEY is NOT a finding — her paper rules it out by name",
         pad + "    secKeysRetired: 'متقاعد — يفكّ تشفير الصفوف القديمة فقط',\n", 0)
    case("⛔ a non-role key carrying the word is NOT a finding",
         pad + "    usrSomethingRetired: 'متقاعد',\n", 0)
    case("⛔ a COMMENT quoting «تقاعد» is NOT a finding — it is how this ruling is explained",
         pad
         + "    // decision 156: «تقاعد» becomes «تعطيل» here\n"
         + "    /* and «متقاعد» becomes «معطّل» */\n"
         + "    roleVerbDeactivate: 'تعطيل',\n", 0)
    case("⛔ the ENGLISH half is NOT scanned — no ruling covers it",
         pad + "    roleVerbDeactivate: 'تعطيل',\n",
         0,
         footer="  },\n  EN: {\n    roleVerbDeactivate: 'تقاعد',\n  },\n} as const;\n")

    # the blindness directions
    root = _tree(pad + "    roleVerbDeactivate: 'تعطيل',\n")
    try:
        cases.append(("the entry count is non-zero on a real-shaped tree",
                      _scanned_entries(root) > MIN_ENTRIES,
                      "%d entries" % _scanned_entries(root)))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    root = _tree("    roleVerbDeactivate: 'تعطيل',\n")  # only ONE entry — below the floor
    try:
        cases.append(("a tree with too few entries FAILS rather than passing green",
                      check(root) == 1, "check() returned %d" % check(root)))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    root = tempfile.mkdtemp(prefix="role-act-word-empty-")
    try:
        cases.append(("a tree with no dictionary at all FAILS",
                      check(root) == 1, "check() returned %d" % check(root)))
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print()
    print("  role-act-word self-test")
    print()
    failed = 0
    for name, ok, detail in cases:
        print("  %-5s %-78s %s" % ("ok" if ok else "FAIL", name, detail))
        if not ok:
            failed += 1
    print()
    print("  self-test: %d passed, %d failed" % (len(cases) - failed, failed))
    print()
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    if "--check" in sys.argv:
        sys.exit(check(ROOT))
    sys.exit(0 if report(ROOT) == 0 else 0)
