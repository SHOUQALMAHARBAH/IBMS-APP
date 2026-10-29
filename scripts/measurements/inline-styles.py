#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Every `style={{ … }}` in the web tree, per file, against budgets that may only FALL.

WHY A RATCHET AND NOT A BAN
---------------------------
Measured at the start of the design batch: **110 of 111 page files carry inline styling, 1,511
sites across 169 files** — against 18 ready-made primitives and 140 design tokens that almost
nothing used. That is the whole diagnosis: the product did not lack a design system, its screens
did not use the one it had. A flat ban would be a red build across 169 files on day one, which is
how a gate gets switched off; a budget that can only come down is how 1,511 becomes a number
somebody is working through.

A design batch that leaves this count where it found it did not happen. That sentence is the gate.

TWO BUDGETS, NOT ONE
--------------------
This repository's own recorded precedent: `typed-identifier-inputs.py` gates the REQUIRED count
separately from the total because *"a single total lets one class be traded for another behind a
green gate"*. The same applies here with force — moving a declaration out of a screen and into a
primitive is the MIGRATION this batch is about, so one combined number would stay flat while
exactly that work was being done, and would also let somebody empty a screen into
`components/ui/` and call it progress.

WHAT COUNTS, AND WHAT DOES NOT
------------------------------
A SITE is one `style={{` occurrence in a `.tsx` under `apps/web/app` or `apps/web/components`. A
styles module (`*.styles.ts`) is NOT counted and never was: moving a declaration out of a screen
and into a shared `CSSProperties` constant is exactly the migration this measures, so counting the
destination would make progress invisible.

IT DOES NOT MEASURE QUALITY. A screen can hold a hundred token-driven `style={{}}` objects and be
perfectly on-system, and the count would say nothing good about it. What the count is for is the
direction of travel, and the per-file table is what makes a screen's own before/after checkable in
its register row.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOTS = [pathlib.Path("apps/web/app"), pathlib.Path("apps/web/components")]
SITE = re.compile(r"style=\{\{")

# SCREEN_BUDGET is improvisation: everything outside the primitive set. IT MAY ONLY FALL.
# The baseline was the measurement taken before this batch wrote a line — 1,511 total, of which 56
# were already inside `components/ui/`, so 1,455 of screen improvisation.
# 1100 -> 1099 on 2026-10-29: `/screening-health` wrapped its capability table in its OWN
# `overflow-x: auto` div, and `Table` has provided a FOCUSABLE one since batch 3. An
# unfocusable scroller around a focusable one is batch 3's keyboard trap one level out, and
# axe is silent because the outer div rarely overflows. 16 more sites across 9 files still
# do it — counted, not swept.
SCREEN_BUDGET = 1099

# UI_BUDGET is the primitive set itself — where a style is SUPPOSED to live. It is gated rather
# than merely reported, because a primitive that grows a hundred one-off objects has stopped being
# a primitive; it rises only when a new primitive genuinely lands, which is a deliberate edit with
# a reason beside it rather than a drift.
#
# 56 before this batch; 106 after the five composition primitives the approved reference screens
# are made of (Icon, BrandMark, Tiles, Panels, Figures) — the destination the screen count falls
# into — then 120 with the two the sign-in screen needed (AuthFrame, IconField).
#
# AND THE SPLIT IS WHAT MADE THAT CLASSIFICATION A DECISION RATHER THAN AN ACCIDENT: AuthFrame and
# IconField were first written into `components/auth/`, where the gate counted their 14 sites as a
# screen REGRESSION — correctly, by its own rule, since `components/ui/` is the primitive set and
# everything else is a screen. Both are reusable and neither knows anything about authentication
# (one takes children, the other takes props), so they belong in the set; what the gate refused
# was leaving a shared frame in the bucket that measures improvisation, which would have punished
# exactly the refactor it exists to encourage.
#
# 126 with `BrandPitch` — the eighth primitive, and the one the pilot deliberately could not write.
# The sign-in brand panel shipped wordless because the i18n tree held no product sentence to slice
# and rule 8(d) forbids writing one; the owner answered that on 2026-10-29 by pointing at her own
# bilingual flyers and the reference page that composes three of their capability lines. Six sites:
# the panel's own grid, its two paragraphs, the chip list, a chip, and the chip icon's colour.
UI_BUDGET = 126

UI_DIR = pathlib.Path("apps/web/components/ui")

# A floor, so an emptied matcher cannot report a clean sweep. 174 files carry at least one site
# today; a run that finds fewer than 100 has a broken parser, not a finished batch.
FILE_FLOOR = 100


def main() -> int:
    counts: dict[str, int] = {}
    for root in ROOTS:
        if not root.is_dir():
            sys.exit("REFUSED: %s is not a directory — run from the repository root" % root)
        for path in sorted(root.rglob("*.tsx")):
            text = path.read_text(encoding="utf-8")
            n = len(SITE.findall(text))
            if n:
                counts[path.as_posix()] = n

    total = sum(counts.values())
    files = len(counts)

    if files < FILE_FLOOR:
        sys.exit(
            "REFUSED: only %d file(s) carry an inline style, floor is %d — the matcher is broken, "
            "not the tree" % (files, FILE_FLOOR)
        )

    ui_total = sum(n for p, n in counts.items() if p.startswith(UI_DIR.as_posix()))
    screen_total = total - ui_total
    pages = {p: n for p, n in counts.items() if p.endswith("/page.tsx")}

    print("SCREEN sites (improvisation)  %5d   budget %d" % (screen_total, SCREEN_BUDGET))
    print("  of which in a page.tsx      %5d   across %d page(s)" % (sum(pages.values()), len(pages)))
    print("UI sites (the primitive set)  %5d   budget %d" % (ui_total, UI_BUDGET))
    print("files carrying at least one   %5d" % files)
    print("")
    print("The heaviest twenty — a screen's own figure belongs in its register row:")
    for path, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:20]:
        print("  %-62s %4d" % (path.replace("apps/web/", ""), n))

    screen_hint = (
        "Compose from `components/ui/` or move the declaration into a `*.styles.ts`; do not raise\n"
        "this number to make a screen land."
    )
    ui_hint = (
        "Raise this ONLY for a new primitive, in the commit that adds it, with the reason beside\n"
        "the number — never to absorb a screen's own styling."
    )

    failed = False
    for name, value, budget, hint in (
        ("SCREEN_BUDGET", screen_total, SCREEN_BUDGET, screen_hint),
        ("UI_BUDGET", ui_total, UI_BUDGET, ui_hint),
    ):
        if value > budget:
            print("")
            print("FAILED: %d against %s of %d. It may only FALL." % (value, name, budget))
            print(hint)
            failed = True
        elif value < budget:
            print("")
            print(
                "FAILED: %d against %s of %d — lower it to %d in this script."
                % (value, name, budget, value)
            )
            print(
                "A ratchet that is not tightened when the work is done is a ceiling, which is how\n"
                "nine declared parenthetical rows went stale while the gate stayed green."
            )
            failed = True

    if failed:
        return 1

    print("")
    print(
        "OK — %d screen sites and %d primitive sites, both exactly at budget."
        % (screen_total, ui_total)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
