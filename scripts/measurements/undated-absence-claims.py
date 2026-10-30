"""Every absence claim in the documentation must carry the date it was measured.

WHY THIS EXISTS, and it is not hypothetical. `README.md` carried, inside the Cross-Selling row:

    the Policy module (Domain B) is not built, so `Policy` is empty everywhere

while `apps/api/src/modules/policy/policy.controller.ts` ships TWELVE routes. It was true when it
was written. The owner was told her system could not issue a policy, made a plan on that answer,
and the answer had to be retracted.

**AN ABSENCE ROTS AND A PRESENCE DOES NOT.** "X is not built" becomes false the day somebody builds
X, silently, with nothing failing. "X is built" stays true. That asymmetry is the whole design:
this script reads only the negative direction, and asks one thing of each claim it finds — WHEN
was that measured?

THE PATTERN IS DECLARED HERE, IN THE GATE, AND THAT IS THE POINT.
Two greps a week apart gave 36 and 62 over the same file. Neither was wrong; they asked different
questions, and a count whose method is not written down is the exact defect this gate exists to
remove. So `CLAIM_SHAPES` below IS the definition, and the figure this script prints is the only
figure to quote. Do not quote 36 or 62.

WHAT IS DELIBERATELY NOT A CLAIM, measured before being excluded rather than assumed. Each of these
was probed across this same corpus, and each is dominated by a shape that is not an absence claim:

    never       1399 hits, and almost every one is an INSTRUCTION — "never write a literal white
                on `--brand-600`". An instruction does not rot when the code changes; it is the
                thing the code is held to.
    cannot      1019 hits, almost all INVARIANTS — "an `AuditLogEntry` row cannot be deleted".
                Same argument: a property being asserted, not a gap being reported.
    has no      355, and it mostly describes a MODEL'S FIELDS ("`Claim` has no staff user field"),
                a schema fact a migration would change loudly. Only the reader-side forms
                ("has no screen", "has no caller") are in the pattern below.
    zero X      298, mostly MEASUREMENTS, which by construction carry their own figure and usually
                their date.
    there is no 247, mixed, and the mix is not separable by pattern — the half that is a real gap
                is caught by the narrower shapes anyway.
    not yet      60, mixed, and much of it is wording about a RECORD'S state rather than the
                system's.

Widening to any of those makes this gate noise, and a noisy gate gets ignored — which is how the
sentence at the top of this file came to be written in the first place.

HOW A CLAIM COUNTS AS DATED. An ISO date (`2026-10-30`, or `2026-10`) on the claim's own line, or
within `DATE_LOOKBACK` lines above it, or in the nearest preceding markdown heading. Those are the
three shapes this repository actually uses: a `What's New` row that opens with its date, a dated
section heading, and a correction written beside its claim ("CORRECTED 2026-10-23: ...").

IT IS A REPORT, NOT A GATE AT ZERO, AND THAT IS DELIBERATE. A gate at zero forces every undated
claim to be swept in one commit, and a rushed sweep over 11,000 lines of register is exactly how
those wrong sentences were written. So the budget starts at whatever the pattern finds today and
MAY ONLY FALL.

    python scripts/measurements/undated-absence-claims.py            # report
    python scripts/measurements/undated-absence-claims.py --check    # ratchet, for CI
"""

from __future__ import annotations

import pathlib
import re
import sys

# The budget may only FALL. Lower it as claims are dated or corrected; never raise it.
#
# 167 of 385, measured 2026-10-30 by the pattern below, on the tree this script lands in.
# NEITHER 36 NOR 62: both of those were greps whose method was never written down, which is why
# the figure to quote is this one and the definition that produced it is thirty lines further down.
#
# Two things measured while establishing it, because a baseline nobody checked is the shape this
# whole gate exists to remove:
#   - THE DOCUMENTATION MOVE CHANGED NOTHING. Scanned against HEAD and against the moved tree
#     through this script's own `scan()`, the undated figure was 178 both times and both
#     difference sets were EMPTY — so relocating 18,000 lines neither created nor hid a claim.
#   - MY OWN NEW TEXT WAS COUNTED AND DATED rather than exempted: three claims in the rewritten
#     `SECURITY.md` carried no date, this gate flagged its own author, and they were dated.
BUDGET = 167

MEASURED_ON = "2026-10-30"

# ---------------------------------------------------------------- the declared pattern
#
# Each entry is a regex over one line of markdown. Keep them NARROW: every one asserts that a THING
# IN THIS SYSTEM is currently missing, which is the only class that rots.
CLAIM_SHAPES: list[tuple[str, str]] = [
    (r"\b(?:is|are|was|were)\s+not\s+built\b", "not built"),
    (r"\b(?:does|do|did)\s+not\s+exist\b", "does not exist"),
    (r"\bno\s+\w+(?:\s+\w+)?\s+exists?\b", "no X exists"),
    (r"\bnothing\s+reads\b", "nothing reads"),
    (r"\bnot\s+implemented\b", "not implemented"),
    (r"\bremains?\s+specification-only\b", "specification-only"),
    (r"\breaches\s+nobody\b", "reaches nobody"),
    (r"\b(?:is|are)\s+unreachable\b", "unreachable"),
    (r"\b(?:is|are)\s+absent\b", "absent"),
    (r"\bno\s+screen\b", "no screen"),
    (r"\b(?:is|are)\s+empty\s+(?:everywhere|on|in|across)\b", "is empty everywhere"),
    (r"\b(?:is|are)\s+deferred\b", "deferred"),
    (r"\bhas\s+no\s+(?:screen|caller|reader|consumer|web\s+caller)\b", "has no reader"),
]

DATE = re.compile(r"\b20\d\d-\d\d(?:-\d\d)?\b")
HEADING = re.compile(r"^#{1,6}\s")
DATE_LOOKBACK = 12

# A CLAIM INSIDE QUOTATION MARKS IS BEING QUOTED, NOT MADE, so it carries no measurement date of
# its own and asking for one is noise. Measured before adopting this rather than assumed: NINE
# undated matches sit inside quotes, and every one of them is a quotation —
#
#   a grep pattern inside a shell command           (`deferred-register.md:26`)
#   a quoted comment SHAPE being described          (`deferred-register.md:308`)
#   a section HEADING quoting the claim it is about  (`design-pass-register.md:2250`)
#   a sentence about the KIND of claim that ages     (`duty-segregation-mode.md:644`)
#   a quoted validation message                      (`findings-register.md:3808`)
#   two "I nearly reported 'no screen'" narratives   (`findings-register.md:4994`, `:5056`)
#   a quoted UI string                               (`kyc-path.md:30`)
#   a quoted example inside an instruction           (`SECURITY.md:381`)
#
# None is an assertion about what this system currently contains, which is the only class that
# rots. SINGLE quotes are deliberately NOT included: this documentation uses `'never'` and
# `'not scheduled'` to name a code literal that IS a live finding about the tree.
QUOTED = re.compile(r'"[^"]*"|“[^”]*”|«[^»]*»')

ROOT_FILES = ["README.md", "IMPROVEMENTS.md", "CLAUDE.md", "SECURITY.md"]


def corpus() -> list[pathlib.Path]:
    out = [pathlib.Path(f) for f in ROOT_FILES if pathlib.Path(f).is_file()]
    out += sorted(pathlib.Path("docs").glob("*.md"))
    return out


def dated(lines: list[str], i: int) -> bool:
    if DATE.search(lines[i]):
        return True
    for j in range(max(0, i - DATE_LOOKBACK), i):
        if DATE.search(lines[j]):
            return True
    for j in range(i - 1, -1, -1):
        if HEADING.match(lines[j]):
            return bool(DATE.search(lines[j]))
    return False


def scan() -> tuple[list[tuple[str, int, str, str]], int]:
    shapes = [(re.compile(p, re.I), name) for p, name in CLAIM_SHAPES]
    undated: list[tuple[str, int, str, str]] = []
    total = 0
    for path in corpus():
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            quoted = [m.span() for m in QUOTED.finditer(line)]
            for rx, name in shapes:
                hit = rx.search(line)
                if hit:
                    if any(a <= hit.start() and hit.end() <= b for a, b in quoted):
                        break  # quoted, not claimed
                    total += 1
                    if not dated(lines, i):
                        undated.append(
                            (str(path).replace("\\", "/"), i + 1, name, line.strip()[:120])
                        )
                    break
    return undated, total


def main() -> int:
    check = "--check" in sys.argv
    undated, total = scan()

    # NON-VACUITY. A pattern that silently stops matching reports a clean nothing, which is
    # indistinguishable from every claim being dated. This repository has paid for that shape
    # four times.
    if total == 0:
        print("REFUSED: the pattern matched NOTHING across the whole corpus.")
        print("That is not a clean result — it means the matcher broke. Fix it before trusting it.")
        return 1

    by_file: dict[str, int] = {}
    for f, _, _, _ in undated:
        by_file[f] = by_file.get(f, 0) + 1

    print(f"absence claims matched : {total}")
    print(f"of those, UNDATED      : {len(undated)}")
    print(f"shapes in the pattern  : {len(CLAIM_SHAPES)}  (declared in this file — quote THIS figure)")
    print()
    print("undated, by file:")
    for f, n in sorted(by_file.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5}  {f}")

    if not check:
        print()
        print("rows (first 60):")
        for f, ln, name, text in undated[:60]:
            print(f"  {f}:{ln}  [{name}]")
            print(f"        {text}")

    if check:
        print()
        if len(undated) > BUDGET:
            print(f"FAIL: {len(undated)} undated absence claims against a budget of {BUDGET}.")
            print("An absence claim rots. Date it where it is written, or re-measure and correct it.")
            return 1
        if len(undated) < BUDGET:
            print(f"FAIL: only {len(undated)} undated claims remain against a budget of {BUDGET}.")
            print(f"Lower BUDGET to {len(undated)} — a budget left above the real figure absorbs")
            print("the next undated claim silently, which is what makes a ratchet a ceiling.")
            return 1
        print(f"OK: {len(undated)} undated absence claims, at budget.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
