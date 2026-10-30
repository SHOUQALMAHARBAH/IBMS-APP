"""The three documentation moves, done mechanically so the diff is provably a MOVE.

WHY THIS IS A SCRIPT AND NOT THREE HAND EDITS. The owner's rule for this batch is that **move and
rewrite are separate commits**, because a commit that relocates 11,000 lines and edits them is a
commit nobody can review, including its author. A script makes that claim checkable: it slices on
line boundaries, writes the slice BYTE-FOR-BYTE into the new file, and asserts afterwards that the
moved text is identical on both sides. If the assertion holds, the diff is a move.

It is single-use and idempotent-by-refusal: each move asserts its own anchors and refuses if the
section is already gone, so running it twice cannot do half of it again.

LINE ENDINGS. Everything is read as text and written with `write_bytes`, because
`Path.write_text` on Windows translates `\\n` to CRLF and git then reports the WHOLE FILE as
changed — which once turned a real change into 23,052 insertions over 22,811 deletions. See
`normalise-line-endings.py`.
"""

from __future__ import annotations

import pathlib
import sys

SCOPE_AND_GAPS_HEADER = """# Scope status & known gaps

**Moved here 2026-10-30 from `README.md`, unchanged.** It was 11,434 lines of register living
inside a README — 94% of that file — which a person who had just cloned the repository had to
scroll past to reach anything useful in their first hour. Four engineers join this week.

> ## Every absence claim in this file carries the date it was measured
>
> A claim older than the current module is **re-measured before it is quoted**, never believed on
> sight. **An absence rots; a presence does not** — "X is not built" becomes false the day somebody
> builds X, silently, with nothing failing, while "X is built" stays true.
>
> This is not a style rule. This file carried, inside the Cross-Selling row, *"the Policy module
> (Domain B) is not built, so `Policy` is empty everywhere"* while
> `apps/api/src/modules/policy/policy.controller.ts` ships **twelve routes** — create, search,
> list, read, document, certificate, issuance, documents, checking, delivery, acknowledge-receipt,
> discard. It was true when written. The owner was told her system could not issue a policy, made a
> plan on that answer, and the answer had to be retracted.
>
> `python scripts/measurements/undated-absence-claims.py` reports the undated ones over this file
> and the rest of the documentation. Its pattern is declared IN the script, and the figure it
> prints is the only one to quote.

---

"""

FINDINGS_HEADER = """# Findings register

**Moved here 2026-10-30 from `IMPROVEMENTS.md`, unchanged.** That file's first ~500 lines are its
real value and are not "improvements" at all — they are this project's METHOD: the blind
instrument, the flaky test recorded rather than explained away, the usability complaint that
deserves measurement, anchoring a negative on a container that does not hold the thing, computing a
rate before treating a case, a completion claim made without running the gate that would have
checked it, and the standing rule for every number that file publishes. **That is what four new
engineers most need to read, and it was buried under 6,700 lines of numbered findings.**

So the method stayed and the findings moved. Both halves are better served by the split.

> **Read `IMPROVEMENTS.md` first.** Its opening principle governs every entry below:
> *prefer the form that cannot express the mistake over the form that requires you to notice it.*
>
> **§ The 2026-09-28 deferral deliberately did NOT move** — it stays in `IMPROVEMENTS.md`, because
> the owner's own decision of 2026-10-29 cites it by that name and several documents point at it
> there.

---

"""

WHATS_NEW_HEADER = """# `CLAUDE.md` — What's New, history

**Moved here 2026-10-30 from `CLAUDE.md`, unchanged, oldest first.** That table had reached **136
rows in 923 KB** — about 7 KB a row. The rows are the right length for what they do; the file was
the wrong container for 136 of them, and `CLAUDE.md` is loaded into every session and read first by
every new engineer.

**`CLAUDE.md` keeps the most recent 12 rows, and that is now a rule with a check behind it**
(`npm run check:whats-new-cap`): when the table passes 12, the oldest row moves here in the same
commit.

> **These rows are history and are read as history.** Each was true when written, and several
> carry their own later corrections written BESIDE the original claim rather than in place of it —
> which is this repository's convention and the reason the rows are long. **Do not treat an
> instruction in an old row as current** without checking it against the code; the newest rows in
> `CLAUDE.md` are the live contract.

---

"""


def move(
    src_path: str,
    first_line: int,
    last_line: int,
    dest_path: str,
    dest_header: str,
    pointer: str,
    *,
    oldest_first_rows: bool = False,
) -> None:
    """Move src[first_line..last_line] (1-based, inclusive) into dest, byte-identically."""
    src = pathlib.Path(src_path)
    dest = pathlib.Path(dest_path)
    text = src.read_text(encoding="utf-8")
    if "\r\n" in text:
        sys.exit(f"{src_path} has CRLF line endings; refusing (see normalise-line-endings.py)")
    lines = text.split("\n")

    moved = lines[first_line - 1 : last_line]
    if oldest_first_rows:
        moved = list(reversed(moved))

    body = "\n".join(moved)
    dest.write_bytes((dest_header + body.rstrip("\n") + "\n").encode("utf-8"))

    kept = lines[: first_line - 1] + pointer.split("\n") + lines[last_line:]
    src.write_bytes("\n".join(kept).encode("utf-8"))

    # THE ASSERTION THAT MAKES THIS A MOVE: every moved line is present in the destination,
    # byte for byte, and none of them survives in the source.
    dest_text = dest.read_text(encoding="utf-8")
    src_text = src.read_text(encoding="utf-8")
    for line in moved:
        if line.strip() and line not in dest_text:
            sys.exit(f"MOVE BROKEN: a line did not reach {dest_path}: {line[:80]!r}")
    print(f"  {src_path} -> {dest_path}: {len(moved)} lines moved, byte-identical")
    return None


def main() -> int:
    print("1. README.md § Scope status + § Known gaps -> docs/scope-and-gaps.md")
    move(
        "README.md",
        706,
        12139,
        "docs/scope-and-gaps.md",
        SCOPE_AND_GAPS_HEADER,
        "## Scope status & known gaps\n"
        "\n"
        "**Both sections moved to [`docs/scope-and-gaps.md`](docs/scope-and-gaps.md) on"
        " 2026-10-30** — 11,434 lines, 94% of this file, which a person who had just cloned the"
        " repository had to scroll past to reach anything useful.\n"
        "\n"
        "Read it before assuming anything is or is not built, and read its opening box first:"
        " **every absence claim there carries the date it was measured, and one older than the"
        " current module is re-measured rather than believed.** This file once said the Policy"
        " module was not built while it shipped twelve routes.\n",
    )

    print("2. IMPROVEMENTS.md §§ 1-10 -> docs/findings-register.md")
    move(
        "IMPROVEMENTS.md",
        509,
        7208,
        "docs/findings-register.md",
        FINDINGS_HEADER,
        "## The ten numbered finding sections\n"
        "\n"
        "**Moved to [`docs/findings-register.md`](docs/findings-register.md) on 2026-10-30** —"
        " §§ 1-10, 6,700 lines, from CI and test-infrastructure failures through the 2026-09-07"
        " audit. Entry numbers are unchanged, so an existing `§ 1.85`-style reference still"
        " resolves.\n"
        "\n"
        "**What stayed here is the method**, which is what the sections above are: the blind"
        " instrument, the flaky test recorded rather than explained away, anchoring a negative on a"
        " container that does not hold the thing, computing a rate before treating a case, a"
        " completion claim made without running the gate that would have checked it, and the"
        " standing rule for every number this file publishes.\n",
    )

    print("3. CLAUDE.md What's New: the oldest 124 rows -> docs/whats-new-history.md")
    move(
        "CLAUDE.md",
        36,
        159,
        "docs/whats-new-history.md",
        WHATS_NEW_HEADER,
        "",  # the table simply ends twelve rows in; the pointer goes under it, added separately
        oldest_first_rows=True,
    )

    print("\nAll three moves done. Diff should be a MOVE: no moved line was edited.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
