"""Escape the pipes inside backtick spans that are breaking a markdown table row.

The companion to `markdown-table-columns.py`, which only REPORTS. A pipe inside `code` is still a
cell separator to GFM's table parser — that is the whole defect — so escaping exactly those pipes
fixes the row without touching a single structural pipe, which means the column count can only move
toward the header's and never past it.

## IT IMPORTS THE CHECKER'S TABLE DETECTION RATHER THAN RESTATING IT

Deliberately. "What is a table" is one question, and the first version of this pair answered it twice
— at which point the checker was corrected to require a separator line and the fixer was not. The
copy is the one that drifts, and here the drift had teeth: `\\|` inside a code span OUTSIDE a table
renders the BACKSLASH LITERALLY, because escapes do not apply inside code spans and only GFM's table
parser strips them. The duplicated version would have written visible backslashes into eight lines of
README prose. Measured and reverted before it was committed.

## ONLY ROWS WITH TOO MANY CELLS ARE TOUCHED

A row with FEWER cells than its header is a MISSING CELL, which no escape can fix and which this
script refuses to guess at: adding an empty one would invent a blank where somebody's text belongs.

Usage:  python scripts/measurements/markdown-table-escape-pipes.py <file> [file ...]
Exit 1 if any row is left malformed, so it reads as a gate.

NOTE FOR THIS HOST: this is a FILE rather than a `python -` heredoc because heredocs on this machine
eat backslashes — a lookbehind for a backslash arrives with the backslash gone, which is a syntax
error if you are lucky and a pattern matching the empty string everywhere if you are not. This
repository records that quirk and it cost this session several attempts, including one garbled diff.
"""

import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# The module name has hyphens, so it cannot be imported by name. Load it by path instead — one home
# for `tables()` and `columns()` is the point, and a copy here is what this file's header is about.
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "markdown_table_columns",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "markdown-table-columns.py"),
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

columns = _mod.columns
tables = _mod.tables
safe = _mod.safe


def escape_in_code_spans(line):
    out = []
    in_code = False
    for i, char in enumerate(line):
        if char == "`":
            in_code = not in_code
            out.append(char)
        elif char == "|" and in_code and (i == 0 or line[i - 1] != "\\"):
            out.append("\\")
            out.append("|")
        else:
            out.append(char)
    return "".join(out)


def main():
    paths = sys.argv[1:]
    if not paths:
        print("usage: markdown-table-escape-pipes.py <file> [file ...]")
        return 1

    fixed = 0
    left = []
    for path in paths:
        lines = io.open(path, encoding="utf-8").read().split("\n")
        touched = False
        for header_line, header_cols, rows in tables(lines):
            for line_no, line in rows:
                found = columns(line)
                if found == header_cols:
                    continue
                if found > header_cols:
                    candidate = escape_in_code_spans(line)
                    if columns(candidate) == header_cols:
                        lines[line_no - 1] = candidate
                        fixed += 1
                        touched = True
                    else:
                        left.append(
                            (
                                path,
                                line_no,
                                found,
                                header_cols,
                                header_line,
                                "escaping the code spans did not reach the header count — "
                                "there is an unescaped pipe outside any code span",
                            )
                        )
                else:
                    left.append(
                        (
                            path,
                            line_no,
                            found,
                            header_cols,
                            header_line,
                            "FEWER cells than the header: a cell is MISSING, not a stray pipe. "
                            "Adding an empty one would invent a blank where text belongs",
                        )
                    )
        if touched:
            io.open(path, "w", encoding="utf-8", newline="\n").write("\n".join(lines))

    print("markdown-table-escape-pipes: escaped %d row(s)" % fixed)
    for path, line_no, found, header, header_line, why in left:
        print(
            "  LEFT %s:%d has %d column(s) against %d at line %d"
            % (path, line_no, found, header, header_line)
        )
        print("       %s" % safe(why, 130))
    return 1 if left else 0


if __name__ == "__main__":
    sys.exit(main())
