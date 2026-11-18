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

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCANNED = os.path.join("apps", "web")
HOME = os.path.join("apps", "web", "lib", "i18n", "format.ts")
EXCLUDED_DIR = os.path.join("apps", "web", "e2e") + os.sep

CALL = re.compile(r"\.toLocale(?:Date|Time)?String\s*\(")


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
    lines = [
        f"  files scanned under apps/web (excl. e2e)     {scanned}",
        f"  self-formatted dates (budget 0)              {len(findings)}",
    ]
    return findings, lines


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
