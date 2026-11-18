#!/usr/bin/env python
"""NO ARABIC STRING OPENS BY NUMBERING A BACKLOG PROCESS — OWNER DECISION 150 RULING 3.

    python scripts/measurements/process-number-prefix.py             # report
    python scripts/measurements/process-number-prefix.py --check      # gate, budget zero
    python scripts/measurements/process-number-prefix.py --self-test  # prove it can fail

## What was wrong, and it was on twenty-five screens

Twenty-five Arabic descriptions opened «العملية 11 — …», «العمليات 23-30 — …» and so on. That
number is the BACKLOG's own index — Part C process 11, process 23-30 — and it means nothing
whatever to the person reading the screen. It is our build order leaking into their product, at
the top of the paragraph that is supposed to tell them what the screen is for.

Her ruling (150, 3-أ): «يُحذَف من الخمسة والعشرين، ولا تتغيّر كلمة بعده» — delete it from all
twenty-five, and change no word after it.

## Why the budget is ZERO rather than a ratchet

There is no correct instance. A screen never needs to tell its reader which backlog item built
it, so the right number of these is none, and a ratchet would only record how long the next one
survived.

⚠️ AND IT CHECKS THE **VALUE**, NOT THE KEY. The prefix is Arabic prose inside a shipped string;
nothing about the key's name gives it away. Both noun forms are matched — «العملية» (singular)
and «العمليات» (plural, used by `claimIntro`'s «العمليات 23-30 —») — because matching only the
singular would have let the one plural through, which is the shape `decision-index-fit.py`
records for Arabic number agreement and this file inherits rather than rediscovers.
"""
import os
import re
import subprocess
import sys

# This gate PRINTS ARABIC -- the offending string, so a reader can see what it is about -- and
# Windows gives Python a cp1252 stdout, which raises `UnicodeEncodeError` on the first Arabic
# character. CI is Linux and defaults to UTF-8, so the failure appears ONLY on the machine the
# gate is developed on: green in CI, crashing locally, which is the worst direction. Measured
# here on the first run. Same device, and the same reasoning, as `decision-index-fit.py`:
# a `check:` chain is invoked by `npm run`, where nobody passes `PYTHONIOENCODING`.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):  # already UTF-8, or not reconfigurable
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web", "lib", "i18n", "translations")

# A quoted literal in either style -- `customers.ts` uses double quotes, the rest single.
QUOTED = re.compile(r"'((?:[^'\\]|\\.)*)'" + "|" + r'"((?:[^"\\]|\\.)*)"')

# «العملية» or «العمليات», then a digit (Western or Eastern) within a few characters -- the
# space-digit shape of `العملية 11 —`, allowing the digits to be a range like `23-30`.
PREFIX = re.compile(r"^\s*العمل(?:ية|يات)\s+[0-9٠-٩]")


def _files(root: str) -> list[str]:
    """Tracked dictionaries, or a walk on a tree with no `.git` (the self-test's trees)."""
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


def _entry_text(lines: list[str], start: int) -> "str | None":
    """The joined text of the dictionary entry beginning at `lines[start]`.

    A value may sit on the key's own line, on the next one, or across several joined with `+`.
    Reads forward to the line that ends the entry (a trailing comma outside a string) and
    concatenates every quoted piece. Returns None when the entry holds no string literal at all
    (a nested object, a function, a number).

    Bounded at 12 lines: the longest real entry is well under that, and an unbounded walk over a
    malformed file would swallow the rest of the dictionary into one "value".
    """
    out: list[str] = []
    for line in lines[start:start + 12]:
        for a, b in QUOTED.findall(line):
            out.append(a or b)
        if line.rstrip().endswith(","):
            break
    return "".join(out) if out else None


def measure(root: str) -> tuple[list[str], list[str]]:
    findings: list[str] = []
    scanned = values = 0
    for rel in _files(root):
        try:
            with open(os.path.join(root, rel), "rb") as fh:
                body = fh.read().decode("utf-8")
        except OSError:
            continue
        scanned += 1
        lines_of = body.split("\n")
        for n, line in enumerate(lines_of, start=1):
            m = re.match(r"^\s{4}([A-Za-z0-9_]+):\s*(.*)$", line)
            if not m:
                continue
            #
            # 🔴 THE VALUE MAY BE ON THE NEXT LINE, AND THE FIRST VERSION OF THIS GATE COULD
            # NOT SEE THAT -- it matched key and value on ONE line, so every entry prettier had
            # wrapped was invisible. Measured with the plant: putting «العملية 11 —» back onto
            # `rfqNewIntro` (a wrapped entry) left the gate reporting ZERO, which is the exact
            # false green a budget-zero gate exists to make impossible. ⟶ The entry is read to
            # its terminating comma, and every quoted piece joined.
            #
            text = _entry_text(lines_of, n - 1)
            if text is None:
                continue
            values += 1
            if PREFIX.match(text):
                findings.append(
                    f"{rel}:{n}: `{m.group(1)}` opens by numbering a backlog process -- "
                    f"{text[:40]}... Owner decision 150 ruling 3-أ deletes that prefix from "
                    f"all twenty-five, and changes no word after it. The backlog's index means "
                    f"nothing to the person reading the screen"
                )
    lines = [
        f"  dictionary files scanned                     {scanned}",
        f"  first-line values examined                   {values}",
        f"  «العملية N —» prefixes (budget 0)            {len(findings)}",
    ]
    return findings, lines


def run(root: str, check: bool) -> int:
    findings, lines = measure(root)
    print()
    print("  process-number prefixes")
    print()
    for ln in lines:
        print(ln)
    print()
    if findings:
        for f in findings:
            print(f"  ERROR  {f}")
        print()
        print(f"  {len(findings)} error(s)")
        return 1 if check else 0
    print("  ok     no shipped string opens by numbering a backlog process")
    return 0


def _self_test() -> int:
    import shutil
    import tempfile

    def build(tmp):
        d = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "ok.ts"), "wb") as fh:
            fh.write("    goodIntro: 'إنشاء طلب عرض أسعار واحد وإرساله.',\n".encode("utf-8"))

    def plant(name, text):
        def go(tmp):
            p = os.path.join(tmp, "apps", "web", "lib", "i18n", "translations", name)
            with open(p, "wb") as fh:
                fh.write(text.encode("utf-8"))
        return go

    plants = [
        ("clean tree", None, None),
        ("the singular «العملية 11 —»",
         plant("a.ts", "    aIntro: 'العملية 11 — إنشاء طلب.',\n"),
         "opens by numbering a backlog process"),
        # The one `claimIntro` actually used. Matching only the singular would miss it.
        ("the PLURAL «العمليات 23-30 —»",
         plant("b.ts", "    bIntro: 'العمليات 23-30 — المطالبات.',\n"),
         "opens by numbering a backlog process"),
        ("double-quoted, as customers.ts writes its Arabic",
         plant("c.ts", '    cIntro: "العملية 5 — استبيان.",\n'),
         "opens by numbering a backlog process"),
        ("Eastern digits after the word",
         plant("d.ts", "    dIntro: 'العملية ١١ — إنشاء طلب.',\n"),
         "opens by numbering a backlog process"),
        # The word is ordinary Arabic. Only the NUMBERED PREFIX is the defect.
        ("«العملية» used as an ordinary word is NOT a finding",
         plant("e.ts", "    eIntro: 'العملية تبدأ بعد الاعتماد.',\n"),
         None),
        ("the prefix in the MIDDLE of a sentence is not this defect",
         plant("f.ts", "    fIntro: 'تبدأ العملية 11 بعد الاعتماد.',\n"),
         None),
        # 🔴 THE HOLE THE PLANT FOUND, now permanent. The first version matched key and value on
        # ONE line, so every entry prettier had wrapped was invisible -- and the real
        # `rfqNewIntro` is wrapped. Planting the prefix back onto it left the gate reporting
        # ZERO: a budget-zero gate printing a confident green over the defect it exists for.
        ("the value WRAPPED onto the next line",
         plant("g.ts", "    gIntro:\n      'العملية 11 — إنشاء طلب عرض أسعار واحد.',\n"),
         "opens by numbering a backlog process"),
        ("and wrapped across several lines joined with +",
         plant("h.ts", "    hIntro:\n      'العمليات 23-30 — المطالبات ' +\n      'من الإشعار.',\n"),
         "opens by numbering a backlog process"),
    ]
    passed = failed = 0
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="process-prefix-")
        try:
            build(tmp)
            if mutate:
                mutate(tmp)
            errs, _ = measure(tmp)
            if needle is None:
                ok = not errs
                detail = "no errors" if ok else f"UNEXPECTED {errs[:1]}"
            else:
                ok = any(needle in e for e in errs)
                detail = "named it" if ok else f"DID NOT NAME IT -- {errs or '[none]'}"
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<56} {detail}")
            passed += ok
            failed += not ok
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n  self-test: {passed} passed, {failed} failed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    sys.exit(run(ROOT, "--check" in sys.argv))
