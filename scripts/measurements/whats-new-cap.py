"""`CLAUDE.md`'s What's New table is capped at 12 rows.

WHY A CAP RATHER THAN A CONVENTION. That table reached **136 rows in 923 KB** — about 7 KB a row.
The rows are the right length for what they do: each carries what was measured, what was rejected,
and the correction of whatever it made false. The FILE was the wrong container for 136 of them, and
`CLAUDE.md` is loaded into every session and read first by every engineer who joins.

It also grew by 5 rows and 38 KB in the six days between the cleanup being specified and the
cleanup starting, which is the argument for a check rather than a note.

THE OLDEST ROW MOVES TO `docs/whats-new-history.md` IN THE SAME COMMIT. Not later, not in a batch:
a row belongs in the commit that earns it, and a batch of them at the end of a branch becomes one
row summarising work nobody can separate afterwards.

WHAT IT DOES NOT CHECK, said plainly. It counts rows and reads nothing. It cannot tell whether a
row is true, whether its Action-required column is still current, or whether the row it displaced
reached the history file — only that the table is not longer than the cap. The second of those is
what `undated-absence-claims.py` is for.

    python scripts/measurements/whats-new-cap.py            # report
    python scripts/measurements/whats-new-cap.py --check     # gate, for CI
"""

from __future__ import annotations

import pathlib
import re
import sys

CAP = 12

# A row opens with its date in the first cell: `| 2026-10-30 | ...`.
#
# THE `/` FORM IS REAL AND THE FIRST VERSION OF THIS PATTERN UNDER-COUNTED BY ONE BECAUSE OF IT.
# `| 2026-09-22/23 |` is a two-day row, and the pattern expected `/DD-DD` where the file writes
# `/DD` — so the total read 135 against a known 136, and the missing row was that one. The
# non-vacuity floor below could never have caught it: an under-count by one is not zero. What
# caught it was reconciling live + history against the figure measured before the move.
ROW = re.compile(r"^\|\s*20\d\d-\d\d(?:-\d\d)?(?:/\d\d(?:-\d\d)?)?\s*\|")

CLAUDE = pathlib.Path("CLAUDE.md")
HISTORY = pathlib.Path("docs/whats-new-history.md")


def count_rows(path: pathlib.Path) -> int:
    if not path.is_file():
        return -1
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if ROW.match(line))


def main() -> int:
    check = "--check" in sys.argv

    live = count_rows(CLAUDE)
    if live < 0:
        print("REFUSED: CLAUDE.md not found — run this from the repository root.")
        return 1

    # NON-VACUITY. A matcher that silently stops matching reports ZERO rows, which passes a cap
    # check and looks exactly like a tidy table. This repository has paid for that shape four
    # times, so an empty result is a refusal rather than a pass.
    if live == 0:
        print("REFUSED: the row matcher found NO rows in CLAUDE.md's What's New table.")
        print("That is not a tidy table — it means the matcher broke. Fix it before trusting it.")
        return 1

    history = count_rows(HISTORY)

    print(f"CLAUDE.md What's New rows : {live}   cap {CAP}")
    if history < 0:
        print(f"history file              : {HISTORY} IS MISSING")
    else:
        print(f"{HISTORY} rows : {history}")
        print(f"total recorded            : {live + history}")

    if check:
        print()
        if history < 0:
            print(f"FAIL: {HISTORY} does not exist, so a displaced row has nowhere to go.")
            return 1
        if live > CAP:
            print(f"FAIL: {live} rows against a cap of {CAP}.")
            print(f"Move the {live - CAP} OLDEST row(s) to {HISTORY}, oldest first, UNCHANGED, in")
            print("this same commit. Do not shorten a row to fit — the length is what makes a row")
            print("worth keeping, and the history file has no cap.")
            return 1
        print(f"OK: {live} rows, at or under the cap of {CAP}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
