# -*- coding: utf-8 -*-
"""«غير مُهيّأ» — every spelling of it in the web tree, counted before anything is changed.

THE PHRASE SHIPS THREE WAYS and two of them can appear on `/screening-health` at once. The owner
ruled on 2026-10-30: **«غير مُهيّأ», the fully-marked one, is the spelling.** These are the SAME
WORD in Arabic -- a diacritic is not a spelling variant in the sense that changes meaning -- so
this is a NORMALISATION, not a rewording: no sentence's sense changes and no new string is written.

WHY A SCRIPT AND NOT A GREP, which is the finding that produced it: `grep «مهي»` CANNOT MATCH
«مُهيّأ», because a damma sits between the م and the ه. So the first reading of this listed only
the undiacriticised sites and silently omitted the three that are already correct -- a sweep that
reports a subset reads exactly like a sweep that found everything. The comparison is therefore
made on the form with every Arabic combining mark REMOVED.

IT REPORTS TWO POPULATIONS AND CHANGES ONE. The negative PHRASE is the owner's ruling. The
positive word ALONE -- «مهيّأ» as `shConfigured`, and in two sentences explaining what it means --
is a different string whose diacritics she has not been asked about, and `/screening-health`
renders both, so the question of whether the column heading should carry the damma too is hers and
is REPORTED rather than decided here.

Run:  python scripts/measurements/not-configured-spelling.py
Out:  a UTF-8 file, because this console is cp1252 and cannot print Arabic.
"""
import io
import os
import re
import sys
import tempfile

# Every Arabic combining mark this tree can carry, plus the tatweel. Removing them is what makes
# «غير مُهيّأ» and «غير مهيأ» compare equal, which is the only way to find both.
MARKS = set(range(0x064B, 0x0658)) | {0x0640, 0x0670}

ROOTS = ("apps/web/app", "apps/web/components", "apps/web/lib")
OUT = os.path.join(
    os.environ.get("TMP") or os.environ.get("TEMP") or tempfile.gettempdir(),
    "not-configured-spelling.txt",
)

# The bare forms, written WITHOUT marks on purpose so the needle cannot itself be a spelling.
BARE_PHRASE = "غير مهيأ"  # غير مهيأ
BARE_WORD = "مهيأ"  # مهيأ

# When this was written: 12 lines carry the word. The floor is the non-vacuity guard -- a matcher
# that stops matching reports a clean nothing, and "the spelling is already consistent" is exactly
# the answer a broken sweep gives.
FLOOR = 8


def bare(s):
    return "".join(c for c in s if ord(c) not in MARKS)


def run_around(line, idx_bare):
    """The Arabic run in `line` whose bare form starts at `idx_bare`, with its marks intact."""
    seen = 0
    start = None
    for i, c in enumerate(line):
        if ord(c) in MARKS:
            continue
        if seen == idx_bare:
            start = i
            break
        seen += 1
    if start is None:
        return ""
    # Walk forward over as many characters as the bare needle has, marks not counted.
    want = len(BARE_WORD) if BARE_WORD else 0
    taken, end = 0, start
    while end < len(line) and taken < want:
        if ord(line[end]) not in MARKS:
            taken += 1
        end += 1
    while end < len(line) and ord(line[end]) in MARKS:
        end += 1
    return line[start:end]


def main():
    rows = []
    for root in ROOTS:
        for d, _, fs in os.walk(root):
            for f in sorted(fs):
                if not (f.endswith(".ts") or f.endswith(".tsx")):
                    continue
                path = os.path.join(d, f)
                for n, line in enumerate(io.open(path, encoding="utf-8").read().split("\n"), 1):
                    b = bare(line)
                    if BARE_WORD not in b:
                        continue
                    kind = "PHRASE" if BARE_PHRASE in b else "WORD-ALONE"
                    key = re.match(r"\s*([A-Za-z0-9_]+):", line)
                    word = run_around(line, b.index(BARE_WORD))
                    rows.append(
                        (
                            kind,
                            path.replace(os.sep, "/"),
                            n,
                            key.group(1) if key else "(inside a longer string)",
                            word,
                            ",".join("%04X" % ord(c) for c in word),
                        )
                    )

    if len(rows) < FLOOR:
        sys.stderr.write(
            "REFUSED: only %d line(s) carry the word, under the floor of %d. The bare-form "
            "comparison has stopped working -- and a sweep that reports a subset reads exactly "
            "like a sweep that found everything.\n" % (len(rows), FLOOR)
        )
        raise SystemExit(1)

    spellings = {}
    for kind, _p, _n, _k, word, hexes in rows:
        spellings.setdefault((kind, word, hexes), 0)
        spellings[(kind, word, hexes)] += 1

    out = io.open(OUT, "w", encoding="utf-8", newline="\n")
    out.write("lines carrying «%s» with diacritics ignored: %d\n\n" % (BARE_WORD, len(rows)))
    out.write("DISTINCT SPELLINGS\n" + "=" * 92 + "\n")
    for (kind, word, hexes), count in sorted(spellings.items(), key=lambda kv: (-kv[1], kv[0])):
        out.write("%-11s «%s»  %-34s x%d\n" % (kind, word, hexes, count))
    out.write(
        "\nTHE OWNER'S SPELLING IS THE FULLY-MARKED «%s» (damma 064F AND shadda 0651).\n"
        % "مُهيّأ"
    )
    for kind in ("PHRASE", "WORD-ALONE"):
        out.write("\n" + "=" * 92 + "\n%s  (%d)\n" % (kind, sum(1 for r in rows if r[0] == kind)) + "=" * 92 + "\n")
        for k, path, n, key, word, hexes in rows:
            if k == kind:
                out.write("%s:%d\n    key  %s\n    word «%s»  %s\n" % (path, n, key, word, hexes))
    out.close()

    sys.stdout.write("wrote %s\n" % OUT)
    sys.stdout.write(
        "lines %d | distinct spellings %d | phrase %d | word-alone %d\n"
        % (
            len(rows),
            len(spellings),
            sum(1 for r in rows if r[0] == "PHRASE"),
            sum(1 for r in rows if r[0] == "WORD-ALONE"),
        )
    )


if __name__ == "__main__":
    main()
