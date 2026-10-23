"""EXPORTED API-CLIENT FUNCTIONS THAT NOTHING CALLS — and therefore routes both reachability passes
count as REACHED while no screen can exercise them.

## Why this exists

`unreachable-routes.py` and `unreachable-routes-by-verb.py` read the path (and verb) out of every
`apiGet`/`apiPost`/`apiPatch`/`apiDelete` call they can resolve, including the ones INSIDE a
client-helper declaration. A helper nothing calls therefore makes its route look addressed.

MEASURED, NOT REASONED: on 2026-10-23 writing `clearFinancialStrengthRating` and nothing else took
the by-path count 14 -> 13 before any screen called it. So both counts are an UPPER BOUND on
reachability, and `docs/unreachable-routes-triage.md`'s figures are a floor on the real gap rather
than the whole of it.

The worked example is `updateInsurer`: it addresses `PATCH /insurers/:id`, nothing in `apps/web`
calls it, and that route appears in NEITHER findings list. So an office cannot edit an insurer record
at all — including setting the financial-strength rating the clear control now removes — and the two
instruments that exist to find exactly that class both report it reachable.

## What this does and does not claim

It is a REPORT and not a gate. The matcher is textual: a helper called through a variable, re-exported
under another name, or referenced only in a test will read as dead when it is not. So every row is a
CANDIDATE to be read by hand, exactly as the 27 were — the lesson from the first run of the route
script, which claimed 153 before four false-positive classes were closed.

AND A DEAD HELPER IS NOT THE SAME FINDING AS AN UNREACHABLE ROUTE — spot-checked on the first run so
the next reader starts ahead of it. `listSlaHolidays` really is called by nothing (the calendar
component uses `getHolidayYear` instead), so it is a true positive as DEAD CODE — and its route is
still perfectly reachable, through that other helper. The route question is only answered where a
dead helper is the ONLY thing addressing that path and verb, which is what `updateInsurer` is.

    python scripts/measurements/dead-client-helpers.py
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "apps", "web")

# A client helper is an exported function in `lib/**` whose body addresses a route.
EXPORT_FN = re.compile(r"^export (?:async )?function (\w+)\s*[(<]", re.M)
ADDRESSES = re.compile(r"\bapi(?:Get|Post|Patch|Put|Delete|PostFormData|FetchBlob|Fetch)\s*[(<]")

STRIP_BLOCK = re.compile(r"/\*[\s\S]*?\*/")
STRIP_LINE = re.compile(r"//[^\n]*")


def strip_comments(src: str) -> str:
    """Comments are removed before any name is counted.

    Not tidiness: these files document their helpers heavily, and a doc comment naming a sibling
    function would be counted as a call. The seed-sweep gate reported a model as cleared because its
    name appeared in a comment, and this is the same trap.
    """
    return STRIP_LINE.sub("", STRIP_BLOCK.sub("", src))


def walk(base: str, suffixes: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            d for d in dirnames if d not in {"node_modules", ".next", "test-results"}
        ]
        for name in filenames:
            if name.endswith(suffixes):
                out.append(os.path.join(dirpath, name))
    return out


def body_of(src: str, at: int) -> str:
    """The balanced body of the function whose signature starts at `at`."""
    open_brace = src.find("{", at)
    if open_brace == -1:
        return ""
    depth = 0
    for i in range(open_brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_brace : i + 1]
    return src[open_brace:]


def main() -> int:
    lib = os.path.join(WEB, "lib")
    client_files = [p for p in walk(lib, (".ts",)) if not p.endswith(".test.ts")]

    # Everything that could CALL a helper: screens, components and other lib files.
    callers = walk(os.path.join(WEB, "app"), (".tsx", ".ts"))
    callers += walk(os.path.join(WEB, "components"), (".tsx", ".ts"))
    callers += client_files
    caller_text = {p: strip_comments(open(p, encoding="utf-8").read()) for p in callers}

    helpers: list[tuple[str, str]] = []
    for path in client_files:
        src = strip_comments(open(path, encoding="utf-8").read())
        for m in EXPORT_FN.finditer(src):
            if ADDRESSES.search(body_of(src, m.start())):
                helpers.append((os.path.relpath(path, ROOT), m.group(1)))

    if not helpers:
        print(
            "dead-client-helpers: REFUSED — found 0 route-addressing client helpers, which cannot "
            "be true. The matcher is broken, not the codebase.",
            file=sys.stderr,
        )
        return 2

    dead: list[tuple[str, str]] = []
    for rel, name in helpers:
        own = os.path.join(ROOT, rel)
        uses = 0
        for path, text in caller_text.items():
            for hit in re.finditer(r"\b%s\b" % re.escape(name), text):
                # Its own declaration is not a call, and neither is its own re-export line.
                if path == own and text[max(0, hit.start() - 30) : hit.start()].rstrip().endswith(
                    ("export function", "export async function")
                ):
                    continue
                uses += 1
        if uses <= 1:  # 1 = the declaration itself (or a single same-file reference)
            dead.append((rel, name))

    print("route-addressing client helpers : %d" % len(helpers))
    print("called by nothing (candidates)  : %d" % len(dead))
    print()
    if dead:
        print("EACH ROW IS A CANDIDATE TO READ BY HAND, not a finding. The matcher is textual.")
        print()
        for rel, name in sorted(dead):
            print("    %-46s %s" % (name, rel))
    print()
    print(
        "A route addressed ONLY by one of these is counted REACHED by both reachability passes.\n"
        "So `docs/unreachable-routes-triage.md`'s figures are a FLOOR on the real gap."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
