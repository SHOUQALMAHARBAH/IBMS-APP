#!/usr/bin/env python
"""EVERY DATE A PERSON READS IS FORMATTED IN ONE PLACE.

    python scripts/measurements/date-formatting.py             # report
    python scripts/measurements/date-formatting.py --check      # gate, budget zero
    python scripts/measurements/date-formatting.py --self-test  # prove it can fail

## 🔴 OWNER DECISION 146 RULING 1, and why a budget of zero is the only honest number

«كل رقم مكتوب في نصوص النظام غربي» — every figure the system writes is in Western digits.

`lib/i18n/format.ts` implements that: it formats Arabic dates under the BARE `'ar'` locale,
because the full region tag `'ar-JO'` switches to Eastern Arabic-Indic numerals (٠١٢٣…). Seven
sites called `toLocaleDateString` themselves and passed `'ar-JO'`, so a reader in Arabic met
Eastern digits on a policy's inception date and Western digits in the money beside it — on one
screen, in one language.

⚠️ THREE OF THE SEVEN HID BEHIND A DICTIONARY KEY. `t('poldEnUs')` looks like a translated
string and its VALUE was the locale name `'ar-JO'` — so the defect was invisible to a reader
scanning for locale tags, and the key's own name said `EnUs` while it returned Arabic. Those five
keys are deleted, not corrected: a locale is not a translation, and a dictionary is the wrong
place to decide how a number is written.

## What is checked

ZERO calls to `toLocaleDateString(` or `toLocaleString(` anywhere under `apps/web`, outside
`lib/i18n/format.ts` itself. Not a budget that may fall -- zero, because there is no case for a
second implementation: every one of them was the same mistake.

⛔ `apps/web/e2e` is OUT OF SCOPE. A Playwright spec building an EXPECTED string is asserting
against what the screen does, and forcing it through the app's own helper would make the test
agree with the implementation by construction -- which is the one thing an assertion must not do.
"""
import os
import re
import subprocess
import sys

# This gate's self-test prints ⛔ beside its non-findings, and Windows hands Python a cp1252
# stdout which raises UnicodeEncodeError on the first such character. CI is Linux and defaults
# to UTF-8, so the crash appears ONLY on the machine the gate is developed on — green in CI,
# broken locally, which is the worst direction. Same device as `eastern-digits.py`.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web")
HOME = os.path.join("apps", "web", "lib", "i18n", "format.ts")
EXCLUDED_DIR = os.path.join("apps", "web", "e2e") + os.sep

CALL = re.compile(r"\.toLocale(?:Date|Time)?String\s*\(")

#: 🔴 THE SECOND SHAPE — OWNER DECISION 156 RULING 1 (message 50).
#:
#: `toLocaleDateString` was never the only way to write a date by hand. The dashboards and the
#: licence screen CUT THE CHARACTERS out of the ISO string the api sent — `.slice(0, 10)` for a
#: day and `.replace('T', ' ').slice(0, 16)` for a stamp — so twenty-odd dates rendered
#: «2026-11-19» while every other screen rendered «19/11/2026». That is invisible to `CALL`:
#: there is no locale and no formatter on the line at all.
#:
#: ⚠️ AND IT IS NOT ONLY A SECOND SHAPE, IT IS A SECOND DAY. A slice prints the UTC day, and
#: Amman is UTC+3 — measured, `2026-11-20T01:30:00Z` slices to «2026-11-19» while Amman is
#: already on the 20th.
SLICED = re.compile(r"\.slice\(\s*0\s*,\s*(?:10|16)\s*\)|\.replace\(\s*['\"]T['\"]")

#: ⛔ WHERE THE SLICE IS CORRECT, AND IT IS A REAL CASE RATHER THAN AN AMNESTY.
#:
#: `<input type="date">` requires exactly `YYYY-MM-DD`; handing it a formatted date gives an
#: empty control. Two lines on the licence screen feed one, and both are SETTERS rather than
#: renders — so the exemption is keyed on the assignment, not on the file.
INPUT_FEEDER = re.compile(r"(?:^|[^A-Za-z0-9_])set[A-Z]\w*\(")

#: ⛔ THE SLICE CLASS IS SCOPED TO WHAT DECISION 156 ACTUALLY RULED, AND THE REST IS REPORTED.
#:
#: Her ruling names the seven dashboards, the licence screen, and the two shared components that
#: serve them. MEASURED when this class was first switched on over the whole of `apps/web`: it
#: found SIXTY MORE sites outside that scope — consent widgets, screening panels, the holiday
#: calendar, employee-record corrections.
#:
#: Those are a real finding and they are REPORTED rather than failed, because turning them red
#: would be enforcing a ruling she has not made over screens she has not walked. ⛔ Widening this
#: tuple is a decision, not a build: the report prints the out-of-scope count on every run so the
#: debt stays visible instead of becoming a habit.
SLICE_SCOPE = (
    os.path.join("apps", "web", "app", "(app)", "dashboards") + os.sep,
    os.path.join("apps", "web", "app", "(app)", "regulatory-compliance") + os.sep,
    os.path.join("apps", "web", "components", "ui") + os.sep,
)


def _strip_comments(text: str) -> str:
    """Blank comments, KEEPING NEWLINES so line numbers survive.

    Blanking the newlines too collapses the numbering and reports findings at lines that hold
    something else -- measured on `bilingual-names.py`, which did exactly that on its first run.
    """

    def blank(m: "re.Match[str]") -> str:
        return "".join("\n" if c == "\n" else " " for c in m.group(0))

    out = re.sub(r"/\*.*?\*/", blank, text, flags=re.S)
    return re.sub(r"//[^\n]*", blank, out)


def _files(root: str) -> list[str]:
    """Tracked TypeScript under apps/web, or a filesystem walk on a tree with no `.git`.

    Same arrangement as `bilingual-names.py`: tracked-only where it matters, so scratch files and
    plants are invisible; a walk for synthetic self-test trees, so the self-test needs no
    `git init` (which fails intermittently on this host).
    """
    if os.path.isdir(os.path.join(root, ".git")):
        out = subprocess.run(
            ["git", "ls-files", SCANNED],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout
        names = [p for p in out.splitlines() if p.endswith((".ts", ".tsx"))]
    else:
        names = []
        for dirpath, _dirs, fs in os.walk(os.path.join(root, SCANNED)):
            for n in fs:
                if n.endswith((".ts", ".tsx")):
                    names.append(
                        os.path.relpath(os.path.join(dirpath, n), root).replace(os.sep, "/")
                    )
    return sorted(names)


def measure(root: str) -> tuple[list[str], list[str]]:
    findings: list[str] = []
    sliced: list[str] = []
    out_of_scope: list[str] = []
    scanned = 0
    for rel in _files(root):
        norm = rel.replace("/", os.sep)
        if norm == HOME or norm.startswith(EXCLUDED_DIR):
            continue
        try:
            with open(os.path.join(root, rel), "rb") as fh:
                body = fh.read().decode("utf-8")
        except OSError:
            continue
        scanned += 1
        for n, line in enumerate(_strip_comments(body).split("\n"), start=1):
            if CALL.search(line):
                findings.append(
                    f"{rel}:{n}: formats a date or number itself -- call formatDate / "
                    f"formatNumber / formatMoney from lib/i18n/format.ts. A bare "
                    f"toLocaleDateString under 'ar-JO' prints EASTERN digits, which owner "
                    f"decision 146 ruling 1 rules against"
                )
            elif SLICED.search(line) and not INPUT_FEEDER.search(line):
                if not norm.startswith(SLICE_SCOPE):
                    out_of_scope.append(f"{rel}:{n}")
                    continue
                sliced.append(
                    f"{rel}:{n}: cuts a date out of its ISO string -- call formatDate / "
                    f"formatDateTime from lib/i18n/format.ts. Owner decision 156 ruling 1: one "
                    f"date shape on screens. A slice is also the UTC day, so in Amman it prints "
                    f"YESTERDAY between midnight and 03:00"
                )
    lines = [
        f"  files scanned under apps/web (excl. e2e)     {scanned}",
        f"  self-formatted dates (budget 0)              {len(findings)}",
        f"  dates sliced out of an ISO string (budget 0) {len(sliced)}",
        f"  ... and outside decision 156's scope, REPORTED {len(out_of_scope)}",
    ]
    return findings + sliced, lines


def run(root: str, check: bool) -> int:
    findings, lines = measure(root)
    print()
    print("  date formatting")
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
    print("  ok     every date a person reads is formatted by lib/i18n/format.ts")
    return 0


def _in(tmp: str, *parts: str):
    """Write a file inside one of the SLICE_SCOPE directories of a synthetic tree."""
    path = os.path.join(tmp, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return lambda body: open(path, "wb").write(body)


def _dash(tmp: str, body: bytes):
    return _in(tmp, "apps", "web", "app", "(app)", "dashboards", "policy", "page.tsx")(body)


def _ui(tmp: str, body: bytes):
    return _in(tmp, "apps", "web", "components", "ui", "ReportProvenance.tsx")(body)


def _licence(tmp: str, body: bytes):
    return _in(tmp, "apps", "web", "app", "(app)", "regulatory-compliance", "page.tsx")(body)


def _self_test() -> int:
    import shutil
    import tempfile

    def build(tmp):
        d = os.path.join(tmp, "apps", "web", "app")
        os.makedirs(d, exist_ok=True)
        os.makedirs(os.path.join(tmp, "apps", "web", "lib", "i18n"), exist_ok=True)
        os.makedirs(os.path.join(tmp, "apps", "web", "e2e"), exist_ok=True)
        with open(os.path.join(d, "page.tsx"), "wb") as fh:
            fh.write(b"const d = formatDate(x, language);\n")
        # The HOME file legitimately holds the calls.
        with open(os.path.join(tmp, "apps", "web", "lib", "i18n", "format.ts"), "wb") as fh:
            fh.write(b"return d.toLocaleDateString(locale);\n")

    plants = [
        ("clean tree", None, None),
        ("a screen formatting a date itself",
         lambda t: open(os.path.join(t, "apps", "web", "app", "p2.tsx"), "wb")
         .write(b"{new Date(x).toLocaleDateString('ar-JO')}\n"),
         "formats a date or number itself"),
        ("the same through a dictionary key, which is how three of them hid",
         lambda t: open(os.path.join(t, "apps", "web", "app", "p3.tsx"), "wb")
         .write(b"{new Date(x).toLocaleDateString(t('poldEnUs'))}\n"),
         "formats a date or number itself"),
        ("toLocaleString, not only toLocaleDateString",
         lambda t: open(os.path.join(t, "apps", "web", "app", "p4.tsx"), "wb")
         .write(b"{n.toLocaleString('ar-JO')}\n"),
         "formats a date or number itself"),
        ("format.ts ITSELF is not a finding -- it is the one home",
         None, None),
        ("a COMMENT discussing toLocaleDateString is NOT a finding",
         lambda t: open(os.path.join(t, "apps", "web", "app", "p5.tsx"), "wb")
         .write(b"// never call toLocaleDateString here\n/* nor .toLocaleString() */\n"),
         None),
        ("an e2e spec building an expected string is OUT OF SCOPE",
         lambda t: open(os.path.join(t, "apps", "web", "e2e", "a.spec.ts"), "wb")
         .write(b"const want = new Date(x).toLocaleDateString('en-GB');\n"),
         None),
        # --- the SLICE class, decision 156 ruling 1 -------------------------------------
        ("a dashboard slicing the day out of an ISO string",
         lambda t: _dash(t, b"<Td>{c.cancelledAt.slice(0, 10)}</Td>\n"),
         "cuts a date out of its ISO string"),
        ("the STAMP form -- .replace('T', ' ') -- on a shared component",
         lambda t: _ui(t, b"return iso.replace('T', ' ').slice(0, 16);\n"),
         "cuts a date out of its ISO string"),
        ("the licence screen is in scope too",
         lambda t: _licence(t, b"<Td>{term.expiresAt.slice(0, 10)}</Td>\n"),
         "cuts a date out of its ISO string"),
        # ⛔ THE THREE NON-FINDINGS, which are what keep the matcher honest.
        ("⛔ a setter feeding an <input type=\"date\"> is NOT a finding",
         lambda t: _licence(t, b"setExpiresAt(license.expiresAt.slice(0, 10));\n"),
         None),
        ("⛔ a slice OUTSIDE decision 156's scope is reported, not failed",
         lambda t: open(os.path.join(t, "apps", "web", "app", "p6.tsx"), "wb")
         .write(b"<span>{x.createdAt.slice(0, 10)}</span>\n"),
         None),
        ("⛔ a COMMENT describing the slice is NOT a finding",
         lambda t: _dash(t, b"// it used to .slice(0, 10) here\n/* and .replace('T', ' ') */\n"),
         None),
        ("⛔ a slice that is not a date boundary is NOT a finding",
         lambda t: _dash(t, b"const initials = name.slice(0, 2);\n"),
         None),
    ]
    passed = failed = 0
    for label, mutate, needle in plants:
        tmp = tempfile.mkdtemp(prefix="date-formatting-")
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
            print(f"  {'ok  ' if ok else 'FAIL'}  {label:<62} {detail}")
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
