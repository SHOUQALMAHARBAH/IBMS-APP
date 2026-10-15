"""Every row of every markdown table has the same number of columns as its header.

## WHY THIS EXISTS

Written 2026-10-15 after I broke a row of `docs/deferred-register.md` by writing a literal pipe
inside a cell while DESCRIBING the pipe-escaping problem. The row rendered with seven columns in a
five-column table, which silently pushes the trailing cells out of the rendered table.

Then it found three rows of `CLAUDE.md` with the SAME defect, all pre-existing and none mine. Each
had lost its entire **Action required** column — the column a newcomer and an agent read FIRST. That
is the argument for the script: a malformed table does not fail anything, renders without complaint,
and loses exactly the content somebody wrote it to convey.

## A TABLE IS A HEADER FOLLOWED BY A SEPARATOR, AND THE FIRST VERSION DID NOT CHECK THAT

The first version treated ANY line containing an unescaped pipe as a table row. On this repository
that produced THREE false positives, all of the same shape: an ordinary prose bullet whose backtick
span contains pipes and WRAPS across lines, e.g.

    - **`POST /claims/:id/assessment/decision`** (`{ outcome -> APPROVED |
      PARTIALLY_APPROVED | DECLINED }`, `claim.assess`) -- drives ...

The first line became a one-column "header" and the second a two-column "row".

That was not merely noise. The companion fixer escapes pipes inside code spans, and `\\|` inside a
code span OUTSIDE a table renders the BACKSLASH LITERALLY — escapes do not apply inside code spans,
and only GFM's table parser strips them. So a false positive here would have put visible backslashes
into eight lines of README prose. Measured and reverted before it was committed.

So a header is only a header when the NEXT line is a separator (`|---|---|`). That is the GFM rule,
it is what a renderer actually does, and it removes every one of those false positives.

## IT COUNTS UNESCAPED PIPES, WHICH IS A CORRECTION TO ITS OWN FIRST VERSION TOO

The first version counted RAW pipes, so it flagged `\\|` — the CORRECT way to write a literal pipe in
a cell — as a defect. A checker that punishes the right fix is worse than no checker: the next person
reaches for a reword every time, and eventually rewords something that mattered.

## AND IT PRINTS ASCII ONLY

The first version died on `UnicodeEncodeError: 'charmap' codec can't encode character '...'`. This
host's console is cp1252 and these headers are Arabic. A script that dies on its own output looks
exactly like a script that found something, so offending text is rendered ASCII-safe.

Usage:  python scripts/measurements/markdown-table-columns.py [file ...]
        (no arguments: CLAUDE.md, README.md and every .md under docs/)
Exit 1 if any row disagrees with its header.
"""

import glob
import io
import os
import re
import sys

# A pipe that is NOT preceded by a backslash. `(?<!\\)` is a fixed-width lookbehind, so the
# zero-width-backtracking trap this repository records (a lookAHEAD after `\s*`) does not apply.
UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")

# `|---|:--:|` and friends. Must contain a pipe, and nothing but pipes, dashes, colons and space.
SEPARATOR = re.compile(r"^\s*\|?[\s:|-]*\|[\s:|-]*$")


def columns(line):
    """Cell count of a markdown table row, counting only unescaped pipes."""
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|") and not stripped.endswith("\\|"):
        stripped = stripped[:-1]
    return len(UNESCAPED_PIPE.split(stripped))


def is_row(line):
    return "|" in line and UNESCAPED_PIPE.search(line) is not None


def safe(text, width=70):
    """ASCII-only rendering, so this script can never die printing its own finding."""
    return text.strip()[:width].encode("ascii", "replace").decode("ascii")


def tables(lines):
    """Yield (header_line_no, header_cols, [(row_line_no, row_line)]) for each REAL table.

    A real table is a header line whose NEXT line is a separator. Anything else that happens to
    contain a pipe is prose."""
    in_fence = False
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence or not is_row(line) or SEPARATOR.match(line):
            i += 1
            continue
        if i + 1 >= len(lines) or not SEPARATOR.match(lines[i + 1]):
            i += 1
            continue
        header_cols = columns(line)
        header_line = i + 1
        rows = []
        j = i + 2
        while j < len(lines) and is_row(lines[j]) and not lines[j].lstrip().startswith("```"):
            rows.append((j + 1, lines[j]))
            j += 1
        yield header_line, header_cols, rows
        i = j


def check(path):
    findings = []
    lines = io.open(path, encoding="utf-8").read().split("\n")
    for header_line, header_cols, rows in tables(lines):
        for line_no, line in rows:
            found = columns(line)
            if found != header_cols:
                findings.append(
                    (line_no, found, header_cols, header_line, safe(line))
                )
    return findings


def main():
    targets = sys.argv[1:]
    if not targets:
        targets = ["CLAUDE.md", "README.md"] + sorted(
            glob.glob(os.path.join("docs", "**", "*.md"), recursive=True)
        )

    total = 0
    checked = 0
    tables_seen = 0
    for path in targets:
        if not os.path.exists(path):
            continue
        checked += 1
        tables_seen += len(
            list(tables(io.open(path, encoding="utf-8").read().split("\n")))
        )
        for line_no, found, expected, header_line, text in check(path):
            total += 1
            print(
                "%s:%d has %d column(s), its header at line %d has %d"
                % (path, line_no, found, header_line, expected)
            )
            print("    %s" % text)

    # NON-VACUITY, BOTH HALVES. A glob matching nothing reports a clean tree; so does a
    # separator-matching bug that finds no tables at all, which is the exact regression the
    # separator rule could introduce.
    if checked == 0:
        print("markdown-table-columns: examined NO files, which is not a clean result")
        return 1
    if tables_seen == 0:
        print(
            "markdown-table-columns: examined %d file(s) and found NO TABLES, "
            "which is not a clean result" % checked
        )
        return 1

    print(
        "markdown-table-columns: %d file(s), %d table(s), %d malformed row(s)"
        % (checked, tables_seen, total)
    )
    if total:
        print(
            "Escape a literal pipe inside a cell as backslash-pipe. Do NOT reword the cell to avoid it."
        )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
