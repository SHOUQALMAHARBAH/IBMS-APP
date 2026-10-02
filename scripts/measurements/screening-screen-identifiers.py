# -*- coding: utf-8 -*-
"""HOW MANY OF THE REMAINING OPTIONAL IDENTIFIER FILTERS SIT ON A SANCTIONS/SCREENING SCREEN?

    python scripts/measurements/screening-screen-identifiers.py

One question, asked because an INFERENCE was nearly relayed to the owner as fact. The claim was that
Phase 4 (real sanctions screening) was blocked because the screening screen carried required identifier
fields. The required count across the whole app is now 2 and both are on `/audit-trail`, which SUGGESTS
that block is gone — but suggests is not measures, and the suggestion has a specific way of being
wrong: an OPTIONAL identifier filter on a screening screen would still be an identifier field on a
screening screen, just not a required one.

## Why this is not answered by reading the other measurement's output

`typed-identifier-inputs.py` lists the screens that HAVE a typed identifier. Reading a screening screen's
absence from that list is reading an absence — and "there is none" is only as strong as the search that
produced it. This script names the screening screens FIRST, from the route tree, then asks each one
whether it carries an identifier input. An absence then means "this screen was examined and has none"
rather than "this screen did not appear in a list I was looking at for something else".

## What counts as a screening screen

Named explicitly below rather than pattern-matched, because the pattern would be guesswork: a screen
whose job is sanctions/PEP/watchlist screening or the transaction monitoring that consumes it. Each entry
carries why it is in the set, so the set can be argued with.
"""
from __future__ import annotations

import os
import re
import sys

SCREEN_ROOT = os.path.join("apps", "web", "app", "(app)")

# The screening set, with a reason each. A screen NOT here that should be is a defect in this list, which
# is why the list is visible rather than derived.
SCREENING_SCREENS: dict[str, str] = {
    "screening-matches": "the sanctions/PEP match review queue — the screen Phase 4 is about",
    "screening-health": "the screening provider's own state: is the engine answering, is a list stale",
    "watchlist-sync": "the watchlist dataset lifecycle: ingest, publish, roll back a generation",
    "transaction-monitoring": "AML monitoring, which consumes screening state per customer",
    "customers/kyc-queue": "KYC approval, which ScreeningHoldService gates on a clean screening",
}

# NOT in the set, named with the reason, because excluding by silence is how a set stops being
# arguable:
#
#   dpia-screenings — a PDPL Data Protection Impact Assessment SCREENING. The same English word for a
#     different act: it screens a processing activity for privacy risk, not a person against a sanctions
#     list. Including it would inflate the answer with a screen Phase 4 has nothing to do with.
#
# THE FIRST VERSION OF THIS LIST WAS WRONG IN BOTH DIRECTIONS, and that is why the list is visible and
# the existence check below is fatal: it named `kyc-queue` (which is at `customers/kyc-queue`, so the
# path did not exist) and it MISSED `screening-health` entirely. A missing file contributes a silent zero
# and reads exactly like a clean result — the failure mode this whole file was written to avoid.
EXCLUDED_WITH_REASON = {
    "dpia-screenings": "a PDPL impact-assessment screening, not a sanctions screening",
}

# Same field vocabulary as `typed-identifier-inputs.py`, plus the screening-specific names, because a
# screening screen could plausibly ask for a subject id or a dataset id that no other screen uses.
IDENTIFIER_SUFFIXES = ("Id", "id")
EXCLUDE_EXACT = {
    # Not a system identifier: a number read off a document, or a tenant id pasted from Azure. Both
    # verified by hand in `docs/identifier-columns-measured.md` and excluded there for the same reason.
    "nationalId",
    "tenantId",
}


def typed_identifier_inputs(source: str) -> list[tuple[str, str]]:
    """Every `value={someId}` bound to an input, with the line it sits on."""
    found: list[tuple[str, str]] = []
    for match in re.finditer(r"value=\{([A-Za-z][A-Za-z0-9]*)\}", source):
        name = match.group(1)
        if name in EXCLUDE_EXACT:
            continue
        if not name.endswith(IDENTIFIER_SUFFIXES):
            continue
        # The enclosing element has to be an <input>, not a <select> (a select is a picker, not a typed
        # identifier) and not an EntitySearch (which IS the fix).
        start = source.rfind("<", 0, match.start())
        element = source[start : match.start()]
        if "<input" not in element and "<EntitySearch" not in element:
            continue
        line = source[: match.start()].count("\n") + 1
        kind = "EntitySearch (a PICKER — already fixed)" if "<EntitySearch" in element else "typed input"
        found.append((f"L{line} {name}", kind))
    return found


def main() -> int:
    if not os.path.isdir(SCREEN_ROOT):
        print(f"no screens at {SCREEN_ROOT} — run from the repo root", file=sys.stderr)
        return 2

    examined = 0
    typed_total = 0
    picker_total = 0

    print("THE SCREENING SCREENS, EXAMINED ONE BY ONE")
    print("=" * 96)
    for screen, why in EXCLUDED_WITH_REASON.items():
        print(f"  -- {screen:30s} EXCLUDED: {why}")
    print("-" * 96)
    for screen, why in SCREENING_SCREENS.items():
        path = os.path.join(SCREEN_ROOT, screen, "page.tsx")
        if not os.path.exists(path):
            # A named screen that does not exist is a defect in THIS LIST, and it must be loud: a
            # missing file would otherwise silently contribute a zero and look like a clean result.
            print(f"  !! {screen:30s} DOES NOT EXIST at {path} — fix this list, do not read the total")
            continue
        examined += 1
        source = open(path, encoding="utf-8").read()
        fields = typed_identifier_inputs(source)
        typed = [f for f in fields if f[1] == "typed input"]
        pickers = [f for f in fields if f[1] != "typed input"]
        typed_total += len(typed)
        picker_total += len(pickers)
        print(f"  {screen:30s} {len(typed)} typed, {len(pickers)} picker(s)")
        print(f"       ({why})")
        for label, kind in fields:
            print(f"       {label:28s} {kind}")

    print("=" * 96)
    if examined != len(SCREENING_SCREENS):
        print(
            f"ABORT: {examined} of {len(SCREENING_SCREENS)} named screens were examined. A total over a "
            "partial set is not an answer.",
            file=sys.stderr,
        )
        return 2

    print(f"screens examined                       {examined}")
    print(f"TYPED identifier inputs on them        {typed_total}")
    print(f"pickers on them (already fixed)        {picker_total}")
    print()
    if typed_total == 0:
        print(
            "ANSWER: ZERO of the remaining optional identifier filters sit on a sanctions/screening\n"
            "screen. Every identifier field on these FIVE screens is either absent or already a picker.\n"
            "\n"
            "What this does NOT establish: that Phase 4 is unblocked. It removes ONE stated blocker —\n"
            "identifier fields on the screening screen — and says nothing about the others (no real\n"
            "watchlist data, name-only matching, no PEP provider). Those are separate and still open."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
