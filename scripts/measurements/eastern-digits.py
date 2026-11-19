#!/usr/bin/env python
"""NO SHIPPED ARABIC STRING WRITES A NUMBER IN EASTERN ARABIC-INDIC DIGITS — DECISION 146.

    python scripts/measurements/eastern-digits.py             # report
    python scripts/measurements/eastern-digits.py --check      # gate, budget zero
    python scripts/measurements/eastern-digits.py --self-test  # prove it can fail

## Her ruling, and why the budget is ZERO rather than a ratchet

Decision 146 ruling 1-أ: «كل رقم مكتوب في نصوص النظام غربي» — every number written in this
system's text is Western. Annex §٣ names the fifty-three strings it applied to and states the
rule that governs the next one: *«الرقم وحده يتبدّل، حرفاً بحرف. لا تتغيّر كلمة.»*

So there is no correct instance. A ratchet would only record how long the next one survived.

## This is the SECOND half of a rule the product already half-enforced

`apps/web/lib/i18n/format.ts` formats Arabic under the BARE `'ar'` locale precisely because the
region tag `'ar-JO'` switches `Intl` to Eastern digits — that is decision 146 ruling 1 applied to
every number the PROGRAM formats, and `check:date-formatting` guards it. This gate is the same
ruling applied to every number a HUMAN TYPED INTO THE DICTIONARY, which no locale tag can reach:
a literal «٣٠ يوماً» inside a permission description is not formatted by anything.

Fifty-three strings carried one. They were invisible to every existing sweep for exactly the
reason the two halves look alike: the locale gates read CALLS, and these are CHARACTERS.

## Scope, stated rather than assumed

**The AR half of `apps/web/lib/i18n/translations/*.ts`.** The EN half is not scanned because an
Eastern digit there would be a different defect with a different answer, and nobody has ruled on
one; measured on the tree this gate shipped against, the EN halves contain none.

⛔ `docs/` IS OUT OF SCOPE, and that is deliberate rather than an oversight: the owner's own
decision papers are written in Eastern digits throughout — «٥٣ نصّاً», «الحكم ١-أ» — and a gate
that read them would demand the one thing this repository never does, which is editing her text
to suit a matcher. The unit here is a string the PRODUCT SHIPS to a screen.

## U+06F0-U+06F9, the extended set, is matched too — and measured at zero

The Persian/Urdu digit block is a DIFFERENT set of code points that renders near-identically.
Measured 2026-11-19 across every dictionary: zero occurrences, in either language half. It is
matched anyway, because a rule that says "every number is Western" and then passes ۳۰ because it
is a different block would be a rule nobody could state. Finding zero is the reason to keep it
cheap, not the reason to leave it out.
"""
import os
import re
import subprocess
import sys

# This gate PRINTS ARABIC, and Windows hands Python a cp1252 stdout which raises
# UnicodeEncodeError on the first Arabic character. CI is Linux and defaults to UTF-8, so the
# crash appears ONLY on the machine the gate is developed on — green in CI, broken locally,
# which is the worst direction. Same device as `process-number-prefix.py`.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web", "lib", "i18n", "translations")

QUOTED = re.compile(r"'((?:[^'\\]|\\.)*)'" + "|" + r'"((?:[^"\\]|\\.)*)"')

ARABIC_INDIC = "".join(chr(c) for c in range(0x0660, 0x066A))   # ٠-٩
EXTENDED = "".join(chr(c) for c in range(0x06F0, 0x06FA))       # ۰-۹
DIGITS = re.compile("[" + ARABIC_INDIC + EXTENDED + "]")


def _files(root: str) -> list:
    """Tracked dictionaries, or a walk on a tree with no `.git` (the self-test's trees).

    ⛔ It does NOT `git init` a temporary tree. That is the recorded `cygheap read copy failed
    ... Win32 error 299` flake on this host, which once exited 1 on three runs in five while
    printing 8 of 8 passed — a self-test that fails for a reason unrelated to its subject.
    """
    if os.path.isdir(os.path.join(root, ".git")):
        out = subprocess.run(
            ["git", "ls-files", SCANNED],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
        return [p for p in out.splitlines() if p.endswith(".ts")]
    found = []
    for dirpath, _dirs, fs in os.walk(os.path.join(root, SCANNED)):
        for n in fs:
            if n.endswith(".ts"):
                found.append(
                    os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/")
                )
    return sorted(found)


def _ar_span(body: str):
    """(start, end) of the `AR: { ... }` block, or None.

    ⚠️ BRACE-COUNTED RATHER THAN REGEXED. A dictionary's AR half contains nested objects, and
    a lazy `AR:\\s*\\{(.*?)\\}` stops at the first inner closing brace — which would scan a
    fraction of the file and report a confident zero over the rest of it.
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

    🔴 THE NEWLINES ARE THE POINT, and this gate's first run proves why twice over.

    1. A stripper that deletes comment bodies collapses line numbering, and the gate then
       reports a real finding at the wrong line — the recorded `check:bilingual-names`
       defect, where fourteen findings were reported against prose.
    2. And `//`-only stripping is not enough: on its first run this gate reported
       `compliance-risk.ts:540`, which is a BLOCK comment explaining this very ruling and
       quoting «١٥ يوماً» while it does so. That is the comment-quotes-the-pattern blindness
       for the NINTH time in this repository, found again inside the sentence warning about
       it. Both forms are stripped now, and both are permanent self-test cases.
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
            # Walk the literal so a `//` or `/*` INSIDE a string is not treated as a comment.
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


def measure(root: str):
    findings = []
    scanned = lines_read = 0
    for rel in _files(root):
        try:
            with open(os.path.join(root, rel), "rb") as fh:
                body = fh.read().decode("utf-8")
        except OSError:
            continue
        scanned += 1
        body = _strip_comments(body)
        span = _ar_span(body)
        if span is None:
            continue
        # Line numbers must be the FILE's, not the block's, so the offset is kept rather than
        # the block sliced out and re-numbered from one.
        offset_line = body.count("\n", 0, span[0])
        for n, line in enumerate(body[span[0]:span[1]].split("\n"), start=1):
            # Comments are already blanked by `_strip_comments` above, newlines kept. Only
            # QUOTED VALUES are the unit — see that function's docstring for the two real
            # misses that shaped it.
            for a, b in QUOTED.findall(line):
                value = a or b
                lines_read += 1
                hit = DIGITS.search(value)
                if hit:
                    findings.append(
                        f"{rel}:{offset_line + n}: a shipped Arabic string writes a number in "
                        f"Eastern digits ({hit.group(0)!r}) -- {value[:40]}... Owner decision "
                        f"146 ruling 1-أ: «كل رقم مكتوب في نصوص النظام غربي». Replace the DIGIT "
                        f"character for character and change no word"
                    )
    report = [
        f"  dictionary files scanned                 {scanned}",
        f"  Arabic string values examined            {lines_read}",
        f"  values with Eastern digits (budget 0)    {len(findings)}",
    ]
    return findings, report


def run(root: str, check: bool) -> int:
    findings, report = measure(root)
    print()
    print("  Eastern Arabic-Indic digits in shipped Arabic")
    print()
    for ln in report:
        print(ln)
    print()
    if findings:
        for f in findings:
            print(f"  ERROR  {f}")
        print()
        print(f"  {len(findings)} error(s)")
        return 1 if check else 0
    print("  ok     every number in a shipped Arabic string is written in Western digits")
    return 0


def _self_test() -> int:
    import shutil
    import tempfile

    HEAD = "export const X = {\n  AR: {\n"
    TAIL = "  },\n  EN: {\n    a: 'b',\n  },\n};\n"

    def build(tmp):
        d = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "ok.ts"), "wb") as fh:
            fh.write((HEAD + "    good: 'مراجعة دورية خلال 30 يوماً.',\n" + TAIL)
                     .encode("utf-8"))

    def plant(name, inner):
        def go(tmp):
            p = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations", name)
            with open(p, "wb") as fh:
                fh.write((HEAD + inner + TAIL).encode("utf-8"))
        return go

    plants = [
        ("clean tree (Western digits ship fine)", None, None),
        ("a single Eastern digit IS a finding",
         plant("a.ts", "    a: 'خلال ٣٠ يوماً.',\n"),
         "Eastern digits"),
        ("several in one value IS a finding",
         plant("b.ts", "    b: 'مستحق، ٣٠ يوماً، ٦٠، ٩٠، أكثر.',\n"),
         "Eastern digits"),
        ("double-quoted, as customers.ts writes its Arabic",
         plant("c.ts", '    c: "قانون رقم ٢٤ لسنة ٢٠٢٣.",\n'),
         "Eastern digits"),
        # The value may be WRAPPED by prettier onto its own line — the hole that made
        # `process-number-prefix.py`'s first version report a confident zero over its subject.
        # Scanning every quoted literal in the block rather than keyed lines closes it by
        # construction, and this case is what says so.
        ("a WRAPPED value IS a finding",
         plant("d.ts", "    d:\n      'مراجعة دورية خلال ٣٠ يوماً من تاريخ الإشعار.',\n"),
         "Eastern digits"),
        ("and one joined with + across lines",
         plant("e.ts", "    e:\n      'مراجعة دورية ' +\n      'خلال ٦٠ يوماً.',\n"),
         "Eastern digits"),
        # ⛔ THE COMMENT-QUOTES-THE-PATTERN CASE. This repository has shipped that blindness
        # eight times, twice INSIDE the sentence warning about it — and the real dictionary now
        # carries a comment citing «الحكم ٦-أ» in her Eastern digits.
        ("Eastern digits inside a // COMMENT are NOT a finding",
         plant("f.ts", "    // decision 146, الحكم ١-أ, ٥٣ strings\n    f: 'نص بلا أرقام.',\n"),
         None),
        # 🔴 THE REAL MISS, and the reason the stripper is not line-based. On its first run
        # this gate reported `compliance-risk.ts:540` — a BLOCK comment explaining this very
        # ruling and quoting «١٥ يوماً» while it did so.
        ("Eastern digits inside a /* BLOCK */ comment are NOT a finding",
         plant("f2.ts",
               "    /* decision 146: «١٥ يوماً» is the shape this rule is about. */\n"
               "    f2: 'نص بلا أرقام.',\n"),
         None),
        # And the line number must survive the stripping — a stripper that deletes comment
        # bodies renumbers everything below it and reports real findings at wrong lines.
        ("a finding BELOW a block comment is reported at its true line",
         plant("f3.ts",
               "    /* a block comment\n       spanning «٣» lines\n       of prose */\n"
               "    f3: 'بعد التعليق ٩ أيام.',\n"),
         # Line 6: `export const X = {`(1) `  AR: {`(2) then the three comment lines (3-5).
         # A stripper that DELETED the comment would report 3. The number is the assertion.
         "f3.ts:6:"),
        # Arabic prose with no number at all must never fire: the cry-wolf direction is what
        # gets a gate switched off rather than fixed.
        ("Arabic with no digits at all is NOT a finding",
         plant("g.ts", "    g: 'مراجعة دورية لمن يملك الصلاحيات.',\n"),
         None),
        # The EXTENDED (Persian) block renders near-identically and is a different code range.
        # Measured at zero in the repo, matched anyway — see this file's header.
        ("the EXTENDED set U+06F0-U+06F9 IS a finding",
         plant("h.ts", "    h: 'خلال \u06f3\u06f0 يوماً.',\n"),
         "Eastern digits"),
        # 🔴 THE NON-VACUITY FLOOR FOR THE WHOLE GATE. The AR block is brace-counted; if that
        # ever returns None the scan reads NOTHING and prints a confident zero. A finding in a
        # file whose AR block contains a NESTED OBJECT proves the counter walked past it.
        ("a nested object does not end the AR block early",
         plant("i.ts",
               "    nested: { inner: 'لا أرقام هنا' },\n    i: 'بعد الكائن ٧ أيام.',\n"),
         "Eastern digits"),
    ]

    passed = failed = 0
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="eastern-digits-")
        try:
            build(tmp)
            if mutate:
                mutate(tmp)
            findings, _ = measure(tmp)
            blob = "\n".join(findings)
            if needle is None:
                good = not findings
                got = "no errors" if good else f"UNEXPECTED: {blob[:90]}"
            else:
                good = needle in blob
                got = "named it" if good else f"MISSED: {blob[:90] or '(nothing)'}"
            print(f"  {'ok  ' if good else 'FAIL'}  {label:55s} {got}")
            passed += 1 if good else 0
            failed += 0 if good else 1
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print()
    print(f"  self-test: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    sys.exit(run(ROOT, "--check" in sys.argv))
