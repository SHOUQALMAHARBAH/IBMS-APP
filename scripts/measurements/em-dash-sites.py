# -*- coding: utf-8 -*-
"""Owner decision 60 — every em dash a reader can see, so they can be CLASSIFIED one by one.

HER RULING IS CLASSIFY-THEN-CONVERT, NOT A SWEEP. Three words, each for one case:

  * «لم يُقيَّم بعد»  the thing has not been DONE yet
  * «لا ينطبق»       it does not apply at all
  * «غير متوفّر»      the value is HELD and does not resolve

and her instruction with them was that **a site which does not fall cleanly into one of the three
keeps its em dash and is RECORDED**. So this prints ROWS for a person to read, never a count to
drive to zero: a count cleared by stretching a word onto a site it does not fit is worse than a
count that stands.

WHAT IT CANNOT DECIDE, stated rather than discovered. The three cases are distinguished by what the
FIELD MEANS, which no matcher can read — `?? '—'` on a nullable name and `?? '—'` on a field that
does not apply to this row are the same five characters. The rows are candidates to READ.

WHAT IT DELIBERATELY DOES NOT COUNT: an em dash inside PROSE (a sentence that happens to use one as
punctuation), because that is not a stand-in for a missing value, and a dash inside a comment.

THE ROWS GO TO A UTF-8 FILE AND ONLY THE COUNTS TO THE CONSOLE. This host's console is cp1252, so
printing a row carrying Arabic or an em dash raises `UnicodeEncodeError` and the measurement dies
having already found everything — which is exactly how this script failed on its first run. The
same treatment `server-message-identifiers.py` already takes; the output file is gitignored,
because it is a snapshot to read rather than an artefact to keep.
"""
import io
import os
import re
import sys

ROOTS = ("apps/web/app/(app)", "apps/web/components")
DASH = "—"

# A dash standing in for a value, in the three shapes this tree actually uses.
PATTERNS = (
    ("?? ", re.compile(r"\?\?\s*['\"]" + DASH + r"['\"]")),
    (": ", re.compile(r":\s*['\"]" + DASH + r"['\"]")),
    ("{dash}", re.compile(r"\{\s*['\"]" + DASH + r"['\"]\s*\}")),
)
COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)

# A NAME that is held and does not resolve is the one class a matcher CAN recognise, because this
# codebase names such a field `<something>Name` by convention (decision 48's resolvers return a Map
# and a missing key means NO NAME). It is still reported as a CANDIDATE: `knowledge-base`'s
# `titleAr` is a name and is not this case, which is why a person reads the rows.
NAMEISH = re.compile(r"\b\w*Name\b")


def strip_comments(src):
    """Blank out comments, PRESERVING newlines so reported line numbers stay re-derivable."""
    return COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), src)


def main():
    rows = []
    scanned = 0
    for root in ROOTS:
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if not name.endswith(".tsx"):
                    continue
                path = os.path.join(dirpath, name).replace("\\", "/")
                scanned += 1
                src = strip_comments(io.open(path, encoding="utf-8").read())
                for lineno, line in enumerate(src.split("\n"), 1):
                    for shape, pat in PATTERNS:
                        if pat.search(line):
                            rows.append((path, lineno, shape, bool(NAMEISH.search(line)),
                                         line.strip()[:110]))
                            break

    if scanned == 0:
        sys.stderr.write("REFUSED: scanned 0 files - the roots are wrong\n")
        return 1
    # A matcher that stops matching reports a clean nothing. The tree is large and only two screens
    # are converted, so zero here means the patterns broke rather than that the work is finished.
    if not rows:
        sys.stderr.write(
            "REFUSED: 0 sites across %d files. That is a broken matcher, not a finished sweep -\n"
            "run it against an earlier commit before believing it.\n" % scanned
        )
        return 1

    out = os.environ.get("EM_DASH_OUT", "em-dash-sites.txt")
    with io.open(out, "w", encoding="utf-8", newline="\n") as fh:
        for path, lineno, shape, nameish, text in rows:
            fh.write("%s:%d  [%s]%s  %s\n"
                     % (path, lineno, shape, "  NAME?" if nameish else "", text))

    nameish_count = sum(1 for r in rows if r[3])
    sys.stdout.write("rows written to %s\n" % out)
    sys.stdout.write("files scanned        %d\n" % scanned)
    sys.stdout.write("em-dash sites        %d  (candidates to READ, never a count to clear)\n"
                     % len(rows))
    sys.stdout.write("of which name-shaped %d  (candidates for commonNameNotResolved ONLY)\n"
                     % nameish_count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
