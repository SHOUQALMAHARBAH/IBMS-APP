# -*- coding: utf-8 -*-
"""Every hand-written colour in a screen or a component — the design pass's own fourth rule, unguarded.

§4 of the design pass says in its own words that a literal colour in a screen is a defect: it is
invisible to the dark theme and to the next brand change. The batch that said so named `#b91c1c` BY
NAME as the example.

AND NO GATE CAN SEE THEM. Eighteen `check:*` scripts and not one looks for a literal colour:
`check:inline-styles` counts style SITES and not what is in them, `check:css-properties` resolves
bare custom-property references, and `check:token-contrast` reads hex only for the pairings it is
given. So the fourth rule is written and unenforced — a wish rather than a control, which is the
distinction this repository draws everywhere else.

THIS IS A REPORT, NOT A GATE, and deliberately: the fix is the gate rather than the sites, because
N swapped tokens with nothing watching is the same state again in two months. It is here so the
number is re-derivable rather than quoted.

COMMENTS ARE STRIPPED, positions preserved. A colour named in a comment that EXPLAINS why a token
replaced it is not a defect, and counting one is how a report loses its reader.

Run:  python scripts/measurements/literal-colours.py
"""
import io
import os
import re
import sys

ROOTS = (os.path.join("apps", "web", "app"), os.path.join("apps", "web", "components"))

# A hex colour, and the three CSS colour functions a hand-written colour arrives as. `--token: #x`
# inside `globals.css` is NOT in scope: that file is where a colour is SUPPOSED to be written, and
# it is not a `.tsx`.
HEX = re.compile(r"#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
FUNC = re.compile(r"\b(?:rgba?|hsla?)\s*\(")

# When this was written: 21 hex colours across 14 files. The floor is the non-vacuity guard.
FLOOR = 10


def strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        two = src[i : i + 2]
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


def main():
    rows = []
    for root in ROOTS:
        for d, _, fs in os.walk(root):
            for f in sorted(fs):
                if not f.endswith(".tsx"):
                    continue
                path = os.path.join(d, f)
                for n, line in enumerate(strip_comments(io.open(path, encoding="utf-8").read()).split("\n"), 1):
                    for m in HEX.finditer(line):
                        rows.append((path.replace(os.sep, "/"), n, m.group(0)))
                    for m in FUNC.finditer(line):
                        rows.append((path.replace(os.sep, "/"), n, m.group(0) + "…)"))

    if len(rows) < FLOOR:
        sys.stderr.write(
            "REFUSED: %d literal colour(s) found, under the floor of %d. The matcher has stopped "
            "matching, and a clean nothing is exactly what that looks like.\n" % (len(rows), FLOOR)
        )
        raise SystemExit(1)

    by_file = {}
    for path, n, what in rows:
        by_file.setdefault(path, []).append((n, what))

    sys.stdout.write("literal colours: %d across %d files\n\n" % (len(rows), len(by_file)))
    for path in sorted(by_file):
        sys.stdout.write("%s\n" % path)
        for n, what in by_file[path]:
            sys.stdout.write("    L%-6d %s\n" % (n, what))


if __name__ == "__main__":
    main()
