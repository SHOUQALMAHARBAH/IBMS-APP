# -*- coding: utf-8 -*-
"""Every `type="date"` input, its labels, and whether the VISIBLE label says WHICH date.

The owner saw `mm/dd/yyyy` beside «كما في» on `/client-accounting` and proposed the fix herself: a
line under the label naming the date. `Field` already has a `hint` slot wired to
`aria-describedby`, so this needs no new component and no new mechanism -- it needs WORDS, and the
words are hers.

WHAT THIS MEASURES, and why it is a REPORT rather than a gate: most of these fields do not need a
hint. A field labelled «تاريخ الميلاد» already says which date it is. A hint on a field that is
already obvious is noise, and noise is how people stop reading hints -- so the column that says
"this one is fine" is as much of the answer as the list of candidates, and the script refuses to
collapse the two.

IT JUDGES THE **VISIBLE** LABEL, which is the finding that came out of writing it. Four of these
inputs carry an `aria-label` that says something DIFFERENT from the text beside them -- «تاريخ
الرصيد» spoken against «كما في» seen -- and an `aria-label` REPLACES the accessible name, so the
two readers are told different things and nobody proof-reads the invisible one. That is a class
this repository has already recorded four times. The hint renders under the VISIBLE label, so the
visible label is what decides whether one is owed; the divergence is reported beside it.

HOW THE VERDICT IS DERIVED, stated so it can be argued with rather than trusted:

  AS-AT      the label is a bare as-at preposition («كما في», `as of`). It says the reading is a
             snapshot and never of WHAT. A hint is owed.
  RANGE      the label is a bare range bound («من», «إلى», «بداية الفترة»). It says which END and
             never which date. A hint is owed.
  MEANS      the label names what the date MEANS without a date noun («تتوقّف التغطية», «ساري
             من»). READ BY HAND -- most of these are already clear and a hint would be noise.
  NAMES      the label contains a date noun bound to a subject («تاريخ المطالبة»). No hint.

Run:  python scripts/measurements/date-input-labels.py
Out:  a UTF-8 file, because this console is cp1252 and cannot print Arabic.
"""
import io
import os
import re
import sys

WEB = os.path.join("apps", "web")
APP = os.path.join(WEB, "app")
COMPONENTS = os.path.join(WEB, "components")
OUT = os.path.join(os.environ.get("TMP", "."), "date-input-labels.txt")

DATE_INPUT = re.compile(r'type="date"')

LABEL_KEY = re.compile(r"(?<!aria-)label=\{t\(\s*['\"]([A-Za-z0-9_]+)['\"]")
ARIA_KEY = re.compile(r"aria-label=\{t\(\s*['\"]([A-Za-z0-9_]+)['\"]")
# A JSX TEXT NODE on its own line -- the `<label>{t('k')}<input/></label>` shape.
#
# ANCHORED AT BOTH ENDS, and the anchoring is the whole point: an unanchored `\{t\(…\)\}` also
# matches the tail of `aria-label={t('k')}`, and because the backward scan starts at the
# `type="date"` line and walks UP it reached the aria attribute FIRST -- so the invisible label was
# being reported as the visible one on exactly the screens whose two labels disagree, which is the
# divergence this script exists to find. Caught by printing the per-line matches rather than by
# reading the pattern.
BARE_KEY = re.compile(r"^\s*\{t\(\s*['\"]([A-Za-z0-9_]+)['\"]\s*\)\}\s*$")
# Shapes four and five, both on one line: `<label htmlFor="x">{t('k')}</label>` and the
# `<label><span style={…}>{t('k')}</span><input/></label>` wrapper. Five shapes for one job is
# itself worth knowing -- `Field` exists and 18 of these 40 inputs do not go through it.
LABEL_FOR = re.compile(r"<(?:label|span|div)[^>]*>\s*\{t\(\s*['\"]([A-Za-z0-9_]+)['\"]")

# A label that contains a date noun bound to a subject.
NAMES_A_DATE = re.compile(r"تاريخ\s*\S|يوم\s*\S|\bdate\b|\bday\b", re.IGNORECASE)
# A bare range bound -- says which END, never which date.
RANGE_WORD = re.compile(
    r"^\s*(من|إلى|from|to|start|end|بداية|نهاية)\b", re.IGNORECASE
)
# An as-at preposition -- says the reading is a snapshot, never of what.
AS_AT = re.compile(r"كما في|as of|as at|asof", re.IGNORECASE)

# When this was written: 40 date inputs across 25 files. The floor is the non-vacuity guard --
# a matcher that stops matching reports a clean nothing, which is the shape this repository has
# paid for four times.
FLOOR = 30


def dictionaries():
    """Every translation key's AR and EN value, read off the dictionary files."""
    root = os.path.join(WEB, "lib", "i18n", "translations")
    ar, en = {}, {}
    for name in sorted(os.listdir(root)):
        if not name.endswith(".ts") or name == "index.ts":
            continue
        src = io.open(os.path.join(root, name), encoding="utf-8").read()
        halves = re.split(r"\n  EN: \{", src)
        for idx, half in enumerate(halves[:2]):
            target = ar if idx == 0 else en
            for m in re.finditer(
                r"^\s{4}([A-Za-z0-9_]+):\s*(['\"])((?:\\.|(?!\2).)*)\2", half, re.M
            ):
                target.setdefault(m.group(1), m.group(3))
    return ar, en


def walk():
    for base in (APP, COMPONENTS):
        for d, _, fs in os.walk(base):
            for f in fs:
                if f.endswith(".tsx"):
                    yield os.path.join(d, f)


def strip_comments(src):
    """Blank out comments, preserving line positions.

    `audit-trail/page.tsx` carries a doc comment ABOUT `<input type="date">` explaining the
    end-of-day trap, and the first version of this script counted it as TWO date inputs -- which
    is why the figure here is 40 and not the 42 a plain grep reports. Positions are preserved
    rather than the lines deleted, because a line number nobody can re-derive cannot carry a rule.
    """
    out, i, n = [], 0, len(src)
    while i < n:
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
        elif two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append("".join(c if c == "\n" else " " for c in src[i:j]))
            i = j
        else:
            out.append(src[i])
            i += 1
    return "".join(out)


def labels_for(lines, n):
    """(visible key, aria key) for the date input on line `n`.

    FIVE shapes, all five live in this app: `<Field label={t('k')}>`, a
    `<label>{t('k')}<input/></label>` wrapper, `<label htmlFor="x">{t('k')}</label>`,
    `<label><span>{t('k')}</span><input/></label>`, and an `aria-label` on the input itself --
    which sits AFTER `type="date"`, not before it, so it is searched FORWARD.

    The aria-label WINS when both exist, because it REPLACES the accessible name. But the VISIBLE
    label is what the verdict is computed from, since that is where a hint would render; the
    disagreement between them is reported instead of being resolved.
    """
    aria = None
    for fwd in range(n, min(len(lines), n + 7)):
        m = ARIA_KEY.search(lines[fwd])
        if m:
            aria = m.group(1)
            break
    # ONE backward loop trying every shape per line, so the NEAREST label wins whatever shape it
    # is in. Two loops -- `label=` first, then the text-node shapes -- let a FARTHER
    # `label={t('rcOwnerUserId')}` beat a NEARER `{t('rcDueDate')}`, and reported a date input on
    # `/regulatory-compliance` as being labelled "Owner user ID". A verdict computed from the wrong
    # label is worse than no verdict, because it reads like a finding.
    visible = None
    for back in range(n, max(-1, n - 14), -1):
        m = (
            LABEL_KEY.search(lines[back])
            or BARE_KEY.search(lines[back])
            or LABEL_FOR.search(lines[back])
        )
        if m:
            visible = m.group(1)
            break
    return visible, aria


def classify(text):
    if AS_AT.search(text):
        return "AS-AT"
    if RANGE_WORD.search(text):
        return "RANGE"
    if NAMES_A_DATE.search(text):
        return "NAMES"
    return "MEANS"


def main():
    ar, en = dictionaries()
    rows = []
    for path in walk():
        lines = strip_comments(io.open(path, encoding="utf-8").read()).split("\n")
        for n, line in enumerate(lines):
            if DATE_INPUT.search(line):
                visible, aria = labels_for(lines, n)
                rows.append((path.replace(os.sep, "/"), n + 1, visible, aria))

    files = sorted({r[0] for r in rows})
    buckets = {"AS-AT": [], "RANGE": [], "MEANS": [], "NAMES": [], "UNKNOWN": []}
    for path, n, visible, aria in rows:
        key = visible or aria
        if key is None:
            buckets["UNKNOWN"].append((path, n, "", "", "", "", "no label found at all"))
            continue
        a, e = ar.get(key, ""), en.get(key, "")
        if not (a or e):
            buckets["UNKNOWN"].append(
                (path, n, key, "", "", "", "key not in the dictionaries")
            )
            continue
        divergence = ""
        if aria and visible and aria != visible:
            aa = ar.get(aria, "")
            divergence = (
                "ARIA OVERRIDES THE VISIBLE LABEL: spoken «%s» (%s), seen «%s» (%s)"
                % (aa, aria, a, visible)
            )
        elif aria and not visible:
            divergence = "aria-label only -- no visible text beside the control"
        buckets[classify(a or e)].append((path, n, key, a, e, aria or "", divergence))

    out = io.open(OUT, "w", encoding="utf-8", newline="\n")
    out.write("date inputs: %d across %d files\n" % (len(rows), len(files)))
    out.write(
        "AS-AT %d | RANGE %d | MEANS (read by hand) %d | NAMES (no hint) %d | unknown %d\n\n"
        % tuple(len(buckets[k]) for k in ("AS-AT", "RANGE", "MEANS", "NAMES", "UNKNOWN"))
    )

    TITLES = {
        "AS-AT": "A HINT IS OWED -- the label says it is a snapshot, never of WHAT",
        "RANGE": "A HINT IS OWED -- the label says which END of a range, never which date",
        "MEANS": "READ BY HAND -- the label names what the date MEANS but carries no date noun",
        "NAMES": "NO HINT NEEDED -- the label already names its date",
        "UNKNOWN": "UNREADABLE BY THIS SCRIPT -- read by hand",
    }
    for k in ("AS-AT", "RANGE", "MEANS", "NAMES", "UNKNOWN"):
        items = buckets[k]
        if not items:
            continue
        out.write("=" * 92 + "\n%s  (%d)\n" % (TITLES[k], len(items)) + "=" * 92 + "\n")
        for path, n, key, a, e, aria, divergence in items:
            out.write("%s:%d\n" % (path, n))
            out.write("    key : %s\n" % key)
            out.write("    AR  : %s\n" % a)
            out.write("    EN  : %s\n" % e)
            if divergence:
                out.write("    !!  : %s\n" % divergence)
            out.write("\n")

    if len(rows) < FLOOR:
        out.write(
            "\nFLOOR FAILED: only %d date inputs found. The matcher has stopped matching --\n"
            "`type=\"date\"` was 40 across 25 files on 2026-10-29 (42 by a plain grep, two of\n"
            "which are prose inside a comment in audit-trail/page.tsx).\n" % len(rows)
        )
        out.close()
        sys.stderr.write("FLOOR FAILED: %d date inputs, expected >= %d\n" % (len(rows), FLOOR))
        raise SystemExit(1)
    out.close()
    sys.stdout.write("wrote %s\n" % OUT)
    sys.stdout.write(
        "date inputs %d across %d files | AS-AT %d | RANGE %d | MEANS %d | NAMES %d | unknown %d\n"
        % (
            len(rows),
            len(files),
            len(buckets["AS-AT"]),
            len(buckets["RANGE"]),
            len(buckets["MEANS"]),
            len(buckets["NAMES"]),
            len(buckets["UNKNOWN"]),
        )
    )


main()
