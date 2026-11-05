"""EXPORTED API-CLIENT FUNCTIONS THAT NOTHING CALLS — the hand-triage view of the class.

    python scripts/measurements/dead-client-helpers.py

## This file no longer carries its own matcher, and that is the point

It had one, and it disagreed with the module that now answers the question. A second matcher for a
question already measured is this repository's own recorded defect: the em-dash placeholder script was
written twice and the two copies answered **145 against 91**. So the measurement lives in
`dead_helpers.py` — importable, alias-aware, with a `--self-test` over planted inputs — and this file
is the triage context around it.

## Why the class matters

`unreachable-routes.py` and `unreachable-routes-by-verb.py` read the path (and verb) out of every
resolvable `apiGet`/`apiPost`/... call, INCLUDING the one inside a client-helper declaration. A helper
nothing calls therefore made its route look addressed.

MEASURED, NOT REASONED: on 2026-10-23 writing `clearFinancialStrengthRating` and nothing else took the
by-path count 14 -> 13 before any screen called it.

**FIXED 2026-11-05: both passes now COUNT this class and gate it in both directions** — 9 routes in the
by-path pass, 18 in the verb-aware one, over 19 dead helpers of 346. Until then the blind spot was recorded only in prose here and
in a comment inside each script, which a reader of `--check` output never sees. The sentence that used
to close this header — *"so `docs/unreachable-routes-triage.md`'s figures are a FLOOR on the real
gap"* — was true and is now a number instead of a warning.

The worked example is `updateInsurer`: it addresses `PATCH /insurers/:id`, nothing in `apps/web` calls
it, and that route appeared in NEITHER findings list. It lands in the VERB-AWARE pass, not the by-path
one — `insurers/*` reads as addressed there because `GET /insurers/:id` genuinely is, so separating
GET from PATCH is the only way to see it.

## What this does and does not claim

It is a REPORT and not a gate; the gates are the two reachability passes. Every row is still a
CANDIDATE to read by hand — see `dead_helpers.py` for the bias it takes (when in doubt, LIVE) and for
the two renaming mechanisms it asserts are absent rather than assuming.

## THE 2026-11-05 HAND TRIAGE OF ALL 21 ROWS, and it corrected this file twice

Each row read by hand, classified by whether the name occurs outside its own declaration in code, in a
test, or only in a comment:

    CALLED           1   `updateLanguagePreference` — A FALSE POSITIVE, and the only one.
    MENTIONED-ONLY   1   `updateInsurer` — both occurrences are the comments recording its absence.
    ABSENT          19   no occurrence anywhere in `apps/web` outside the declaration.

**CORRECTION 1 — the figure recorded here was 19 of 337; it measured 20 of 346, and ends this batch at
19 of 346 because `updateInsurer` acquired its first caller.** It was stale, and one of
the 19 was wrong: `updateLanguagePreference` is imported as `patchLanguagePreference`
(`lib/i18n/language-context.tsx:14`), so a name-only matcher read a live helper as dead. That is
exactly the "re-exported under another name" false positive the old header predicted and could not
resolve; `dead_helpers.py` resolves the alias exactly.

**CORRECTION 2 — the spot-check this file recorded about itself was FALSE.** It said `listSlaHolidays`
"really is called by nothing ... and its route is still perfectly reachable, through that other
helper". It is not reachable. `getHolidayYear` addresses `GET /sla/holidays/year/:year`; the dead
helper addresses `GET /sla/holidays`. Two different routes on one controller, and the spot-check
compared the helper names rather than the paths they address. `GET /sla/holidays` is in the verb-aware
findings list for that reason.

The point the spot-check was reaching for survives and is still worth having: **a dead helper is not
the same finding as an unreachable route.** A route is only unreachable where the dead helper is the
ONLY thing addressing that path AND verb — which is what the two passes now compute instead of leaving
to a reader.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import dead_helpers  # noqa: E402


def main() -> int:
    measured = dead_helpers.measure()
    dead = measured["dead"]
    assert isinstance(dead, dict)

    print("route-addressing client helpers : %d" % measured["helpers"])
    print("called by nothing (candidates)  : %d" % len(dead))
    print()
    if dead:
        print("EACH ROW IS A CANDIDATE TO READ BY HAND, not a finding. The matcher is textual.")
        print()
        for name in sorted(dead):
            rel = os.path.relpath(dead[name][0], dead_helpers.ROOT)
            print("    %-46s %s" % (name, rel))
    print()
    print(
        "The two reachability passes now COUNT the routes only these address and gate both\n"
        "directions — 9 by path, 18 by verb. Read the verb-aware figure first: it is the larger\n"
        "one, because the by-path pass cannot separate PATCH from a GET on the same path."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
