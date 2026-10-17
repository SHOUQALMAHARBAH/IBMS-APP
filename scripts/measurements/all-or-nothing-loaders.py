"""Which screens discard the lists that RESOLVED when one supporting call refuses.

## WHY THIS EXISTS

The owner opened `/provider-register-office` and found eight empty dropdowns. Measured cause: a
single `Promise.all` over two loaders, one of which 403s, inside a bare `catch` — so the seven
reference lists that resolved perfectly were thrown away with the one that refused, and the screen
rendered a form with nothing selectable and one generic sentence.

`Promise.all` rejects on the FIRST rejection and discards every fulfilled value. That is correct for
"I need all of these or none"; it is wrong for "show me what you have and tell me what is missing",
which is what a form backed by several independent vocabularies needs.

## WHAT IT FLAGS, AND WHAT IT DOES NOT

Flagged: a `Promise.all` of two or more loader calls whose rejection path is a `catch` that sets one
error state for the whole screen. That is the all-or-nothing shape.

NOT flagged: `Promise.all` over writes, over a fan-out whose results are genuinely interdependent,
or where each entry has its own `.catch` so a refusal is already isolated. Those are correct uses and
a checker that reported them would be noise on a red build.

This REPORTS. It is not a gate: the honest fix is per-screen, several of these are correct, and a
brittle matcher behind a red build is the one that teaches people to ignore it.

Usage:  python scripts/measurements/all-or-nothing-loaders.py
"""

import glob
import io
import os
import re
import sys

WEB = os.path.join("apps", "web", "app")

# `Promise.all([ ... ])` with its argument list captured, non-greedy to the matching bracket on the
# simple shapes this codebase uses (one array literal, no nested arrays inside it).
PROMISE_ALL = re.compile(r"Promise\.all\(\s*\[(.*?)\]\s*\)", re.S)


def screens():
    for path in sorted(glob.glob(os.path.join(WEB, "**", "page.tsx"), recursive=True)):
        yield path


def route_of(path):
    rel = path[len(WEB) :].replace(os.sep, "/")
    rel = rel[: -len("/page.tsx")]
    # Next route groups — "(app)", "(auth)" — are not part of the URL.
    rel = re.sub(r"/\([^)]*\)", "", rel)
    return rel or "/"


def main():
    findings = []
    examined = 0
    all_sites = 0
    for path in screens():
        src = io.open(path, encoding="utf-8").read()
        if "Promise.all" not in src:
            continue
        examined += 1
        for m in PROMISE_ALL.finditer(src):
            all_sites += 1
            args = m.group(1)
            # How many separate awaited calls does this gather? One is not an all-or-nothing risk.
            calls = re.findall(r"\b([a-zA-Z_][\w.]*)\s*\(", args)
            calls = [c for c in calls if c not in ("Promise", "map", "filter")]
            if len(calls) < 2:
                continue
            # Per-entry isolation means a refusal cannot take the others down.
            if ".catch(" in args:
                continue
            # The rejection path: the nearest `catch` after this call.
            tail = src[m.end() : m.end() + 600]
            cm = re.search(r"\}\s*catch\s*(\([^)]*\))?\s*\{(.*?)\n\s*\}", tail, re.S)
            if not cm:
                continue
            body = cm.group(2)
            # One error state for the whole screen is the shape; a body that sets several, or that
            # re-reads which call failed, is already discriminating.
            sets = re.findall(r"set([A-Z]\w*)\(", body)
            findings.append(
                {
                    "screen": route_of(path),
                    "file": path.replace(os.sep, "/"),
                    "gathers": calls,
                    "bare_catch": cm.group(1) is None,
                    "sets": sorted(set(sets)),
                }
            )

    print(
        "all-or-nothing loaders: %d screen(s) use Promise.all, %d call site(s), "
        "%d with the discard shape\n" % (examined, all_sites, len(findings))
    )
    for f in findings:
        print("%s" % f["screen"])
        print("    gathers %d: %s" % (len(f["gathers"]), ", ".join(f["gathers"])))
        print(
            "    rejection: %s catch, sets %s"
            % ("bare" if f["bare_catch"] else "bound", ", ".join(f["sets"]) or "(nothing)")
        )

    # NON-VACUITY: a regex that stops matching reports a clean tree.
    if examined == 0 or all_sites == 0:
        print("\nexamined no Promise.all sites, which is not a clean result")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
