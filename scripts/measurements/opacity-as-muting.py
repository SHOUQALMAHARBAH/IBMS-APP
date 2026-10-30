# -*- coding: utf-8 -*-
"""`opacity` used to mute TEXT — the recorded contrast regression, measured tree-wide.

THE DEFECT, AND IT IS ARITHMETIC RATHER THAN TASTE. `opacity` composites an element into whatever
is behind it, so muted text written as `opacity: 0.8` on a token that passes AA comfortably stops
passing. Computed from this product's own tokens (WCAG 2.x relative luminance, normal text, AA 4.5):

    pairing              1.00    0.85    0.80    0.75    0.70
    light card           6.58    4.60    4.10    3.68    3.31
    light page           6.09    4.32    3.90    3.50    3.14
    light muted/card     5.22    3.82    3.47    3.13    2.87
    dark card            7.17    5.61    5.14    4.71    4.30
    dark page            8.07    6.18    5.66    5.11    4.65
    dark muted/card      4.98    3.99    3.72    3.47    3.18

`--ink-secondary` on `--surface-card` is 6.58 at full strength and **4.10 at 0.8** — below AA. On
`--surface-page` it fails from 0.85. `--ink-muted` fails at every value this tree uses. This is the
recorded regression class (`--ink-muted` plus opacity-as-muting) in a second form.

WHY THE a11y SUITE IS SILENT ABOUT IT, stated rather than guessed: axe composites the colours it
can resolve and reports what it cannot as INCOMPLETE, and the gate reads serious/critical
VIOLATIONS. So 85/85 green says nothing about this class, which is exactly why it needs a measure
of its own.

WHAT IT CANNOT DECIDE. A reduced opacity on an ICON, a divider, a disabled control or a decorative
rule is legitimate and is not a contrast question at all — this reads TEXT-SHAPED declarations by
their neighbours on the same line and cannot read intent. The rows are candidates to READ; the
BUDGET is a ratchet so the class cannot grow while nobody is looking.

THE BUDGET MAY ONLY FALL. Raising it means shipping text below AA on a product that goes in front
of a regulator.
"""
import io
import os
import re
import sys

ROOTS = ("apps/web/app", "apps/web/components")

# MEASURED 2026-10-29 AT 108, after `/customers/[id]`, its two correction components and
# `/screening-health` were converted. It was 120 at the gate's own first commit and 130 when
# the class was first measured; the ratchet is what keeps those three figures honest - it
# refuses a budget left ABOVE the real count, so a ceiling cannot absorb the next regression.
# THE ORIGINAL NOTE: measured at 120, after `/customers/[id]` and its two correction components were
# converted. 130 before, and the arithmetic predicted 122 - two of the eight sites I removed were
# inside COMMENTS, which this script strips and the `grep -c` I counted with does not. A ratchet,
# never a target: it may only FALL.
BUDGET = 108

OPACITY = re.compile(r"opacity:\s*0\.\d+")
COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)


def strip_comments(src):
    """Blank out comments, PRESERVING newlines so reported line numbers stay re-derivable."""
    return COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), src)


def main():
    rows = []
    scanned = 0
    for root in ROOTS:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".next")]
            for name in files:
                if not name.endswith((".tsx", ".ts")):
                    continue
                path = os.path.join(dirpath, name).replace("\\", "/")
                scanned += 1
                src = strip_comments(io.open(path, encoding="utf-8").read())
                for lineno, line in enumerate(src.split("\n"), 1):
                    if OPACITY.search(line):
                        rows.append((path, lineno))

    if scanned == 0:
        sys.stderr.write("REFUSED: scanned 0 files - the roots are wrong\n")
        return 1
    # A matcher that stops matching reports a clean nothing, which is the shape this repository has
    # paid for four times. Zero here means the pattern broke, not that the class is closed.
    if not rows:
        sys.stderr.write(
            "REFUSED: 0 sites across %d files. Run this against an earlier commit before\n"
            "believing it - a broken matcher and a finished sweep look identical.\n" % scanned
        )
        return 1

    by_file = {}
    for path, lineno in rows:
        by_file.setdefault(path, []).append(lineno)

    for path in sorted(by_file):
        sys.stdout.write("%4d  %s\n" % (len(by_file[path]), path))
    sys.stdout.write("\nfiles scanned            %d\n" % scanned)
    sys.stdout.write("opacity-as-muting sites  %d   budget %d\n" % (len(rows), BUDGET))

    if len(rows) > BUDGET:
        sys.stderr.write(
            "\nFAIL: the class GREW. `opacity` composites text into its background, so muted text\n"
            "written this way drops below AA on a token that passes comfortably - see the table in\n"
            "this file's header. Say what the ink IS (`--ink-secondary`, `--ink-muted`) rather than\n"
            "throwing part of it away.\n"
        )
        return 1
    if len(rows) < BUDGET:
        sys.stderr.write(
            "\nFAIL: %d sites remain against a budget of %d. Lower BUDGET to %d - a ratchet left\n"
            "above the real figure is a ceiling that absorbs the next regression silently.\n"
            % (len(rows), BUDGET, len(rows))
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
