# -*- coding: utf-8 -*-
"""Every control whose `aria-label` says something DIFFERENT from its visible label.

THE OWNER ASKED FOR A COUNT, NOT A SWEEP. Her words: *"How many controls IN THE WHOLE WEB TREE
have an `aria-label` whose text differs from their visible label? Count them, report the number,
and stop. If it is six, this is closed. If it is sixty, the owner needs to know that before anyone
decides what to do."* So this script reports and gates nothing.

WHY IT IS A CLASS AND NOT SIX FIXES. An `aria-label` REPLACES the accessible name -- it does not
add to it -- so where the two disagree a screen-reader user and a sighted user are told different
things about the same control, and nobody proof-reads the invisible one. On four screens measured
by `date-input-labels.py` the INVISIBLE one was the better sentence, which is backwards: the aria
is supposed to be a floor, not a better version. This repository has recorded the class four times
(`pcAccountAria` said FOUR digits where the field accepts two to four; `incTitleLabel` was BETTER
than the visible `incTitleFieldLabel`), and each time it was found by reading one screen.

FOUR OUTCOMES, NAMED APART, because they are four different things to do:

  DIVERGENT  two keys, two different sentences -- THE CLASS. The aria wins and the eye loses.
  DUPLICATE  two keys, one sentence -- a drift risk; one key would do. Not a defect today.
  REDUNDANT  one key used twice -- the aria adds nothing at all and can simply go.
  ARIA-ONLY  no visible label -- the aria is the only accessible name there is, which is what the
             attribute is FOR. Not a divergence, and this is the biggest bucket by design: an
             icon button, a table-cell control and a filter with its name in the column heading
             all legitimately live here.

WHAT IT CANNOT DECIDE, stated rather than left to be discovered: a literal `aria-label="..."` and
a computed one (`aria-label={row.name}`) cannot be compared against a dictionary key, and a
visible label this app renders in a shape the resolver does not know reads as ARIA-ONLY. Both are
counted and printed as UNRESOLVED, because a count that silently drops what it cannot read is a
count that reads clean.

Run:  python scripts/measurements/aria-vs-visible-label.py
Out:  a UTF-8 file, because this console is cp1252 and cannot print Arabic.
"""
import io
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The sibling's module name has hyphens, so it is loaded by path. ONE home for the label resolver
# is the point: five label shapes live in this app, and a second copy of the walk is a second
# answer to "what names this control" -- which is the very question this script is counting.
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "date_input_labels",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "date-input-labels.py"),
)
_dil = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_dil)

dictionaries = _dil.dictionaries
labels_for = _dil.labels_for
strip_comments = _dil.strip_comments
walk = _dil.walk

OUT = os.path.join(
    os.environ.get("TMP") or os.environ.get("TEMP") or tempfile.gettempdir(),
    "aria-vs-visible-label.txt",
)

ARIA_ANY = re.compile(r"aria-label=")
ARIA_KEY = re.compile(r"aria-label=\{t\(\s*['\"]([A-Za-z0-9_]+)['\"]")
ARIA_LITERAL = re.compile(r"aria-label=\"([^\"]*)\"")

# When this was written: 183 aria-labels across the tree. The floor is the non-vacuity guard --
# a matcher that stops matching reports a clean nothing, and "no control disagrees with its own
# label" is exactly the answer a broken scan gives.
FLOOR = 100


def main():
    ar, en = dictionaries()
    rows = []
    for path in walk():
        lines = strip_comments(io.open(path, encoding="utf-8").read()).split("\n")
        for n, line in enumerate(lines):
            if not ARIA_ANY.search(line):
                continue
            visible, aria = labels_for(lines, n)
            if aria is None:
                # A literal or a computed aria-label -- the resolver only reads `t()` keys.
                lit = ARIA_LITERAL.search(line)
                rows.append(
                    (
                        path.replace(os.sep, "/"),
                        n + 1,
                        "UNRESOLVED",
                        "aria-label is %s, not a translation key"
                        % ("a literal %r" % lit.group(1) if lit else "computed"),
                    )
                )
                continue
            if visible is None:
                rows.append(
                    (path.replace(os.sep, "/"), n + 1, "ARIA-ONLY", "spoken «%s» (%s)" % (ar.get(aria, ""), aria))
                )
            elif visible == aria:
                rows.append((path.replace(os.sep, "/"), n + 1, "REDUNDANT", "one key used twice (%s)" % aria))
            elif ar.get(aria, "") == ar.get(visible, "") and en.get(aria, "") == en.get(visible, ""):
                rows.append(
                    (
                        path.replace(os.sep, "/"),
                        n + 1,
                        "DUPLICATE",
                        "two keys, one sentence -- spoken (%s), seen (%s)" % (aria, visible),
                    )
                )
            else:
                spoken, seen = ar.get(aria, ""), ar.get(visible, "")
                # WHICH READER LOSES. Counted apart because they are opposite defects: FULLER
                # keeps the better sentence out of sight, THINNER drops a qualifier out of
                # earshot, and UNRELATED cannot be told from the resolver having found a
                # neighbouring control's label without reading the screen.
                if spoken and seen and seen in spoken:
                    kind = "DIVERGENT/FULLER"
                elif spoken and seen and spoken in seen:
                    kind = "DIVERGENT/THINNER"
                else:
                    kind = "DIVERGENT/UNRELATED"
                rows.append(
                    (
                        path.replace(os.sep, "/"),
                        n + 1,
                        kind,
                        "spoken «%s» (%s)  |  seen «%s» (%s)" % (spoken, aria, seen, visible),
                    )
                )

    if len(rows) < FLOOR:
        sys.stderr.write(
            "REFUSED: only %d aria-label(s) found, under the floor of %d. The matcher has stopped "
            "matching -- a count of zero divergences is exactly what a broken scan reports.\n"
            % (len(rows), FLOOR)
        )
        raise SystemExit(1)

    order = [
        "DIVERGENT/FULLER",
        "DIVERGENT/THINNER",
        "DIVERGENT/UNRELATED",
        "DUPLICATE",
        "REDUNDANT",
        "ARIA-ONLY",
        "UNRESOLVED",
    ]
    counts = dict((k, 0) for k in order)
    for r in rows:
        counts[r[2]] += 1

    out = io.open(OUT, "w", encoding="utf-8", newline="\n")
    out.write("aria-labels in the web tree: %d across %d files\n" % (len(rows), len({r[0] for r in rows})))
    out.write(" | ".join("%s %d" % (k, counts[k]) for k in order) + "\n")
    divergent = sum(counts[k] for k in order if k.startswith("DIVERGENT"))
    out.write("\nDIVERGENT, all three directions: %d\n" % divergent)
    out.write(
        "\nTHE CLASS THE OWNER ASKED FOR IS `DIVERGENT`: a control whose aria-label says something\n"
        "different from the text beside it. It is split by WHICH READER LOSES, because FULLER and\n"
        "THINNER are opposite defects and UNRELATED cannot be told from a resolver that found a\n"
        "NEIGHBOURING control's label without reading the screen. Every other bucket is printed so\n"
        "the number can be argued with rather than trusted.\n"
    )
    for kind in order:
        out.write("\n" + "=" * 92 + "\n%s  (%d)\n" % (kind, counts[kind]) + "=" * 92 + "\n")
        for path, n, k, why in rows:
            if k == kind:
                out.write("%s:%d\n    %s\n" % (path, n, why))
    out.close()

    sys.stdout.write("wrote %s\n" % OUT)
    sys.stdout.write(
        "aria-labels %d across %d files | DIVERGENT %d (" % (len(rows), len({r[0] for r in rows}), divergent)
        + ", ".join(
            "%s %d" % (k.split("/")[1].lower(), counts[k]) for k in order if k.startswith("DIVERGENT")
        )
        + ") | "
        + " | ".join("%s %d" % (k.lower(), counts[k]) for k in order if not k.startswith("DIVERGENT"))
        + "\n"
    )


if __name__ == "__main__":
    main()
