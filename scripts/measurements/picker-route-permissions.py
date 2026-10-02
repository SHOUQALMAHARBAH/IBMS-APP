# -*- coding: utf-8 -*-
"""WHICH SCREENS TYPE AN ENTITY'S UUID, AND WHAT PERMISSION EACH OF THEM IS GATED ON.

    python scripts/measurements/picker-route-permissions.py

This answers one question and it is the question the owner's decision turns on: a picker's search route
is gated on ANY OF the permissions of the screens that use it. That rule cannot be applied without the
list, and the list cannot be guessed — the whole reason it exists is a case where guessing went wrong:
an Executive could not find an employee, because the employee search was gated on the permission of the
screen it was BUILT for rather than on the permissions of the screens that need it.

## What it reads, and why that and not the API

The SCREEN, not the route. A route can accept a filter no screen offers, and a screen can render a
field the route ignores; what decides whether a person is stuck is what is ON THE SCREEN in front of
them. Same authority choice as `dashboard-figures.py`, and for the same reason.

## What a "typed input" is here

State bound to an `<input>` — `value={insurerId}` or a `setInsurerId(` call. A uuid merely RENDERED in
a cell is a different defect (`rendered-identifiers.py` measures that one) and must not be counted
here: substituting a name into a cell needs the payload to carry a name, while a typed field needs a
search route, and conflating them produces a list where half the rows cannot be fixed by the thing
being built.

## Known limits, stated rather than left for the next reader to discover

* A field named something this script does not know about is invisible to it. The name lists below are
  from `docs/identifier-columns-measured.md`, which was built by reading all 102 screens; a new screen
  using a new spelling needs adding here.
* The permission extraction reads three shapes (`has(...)`, `permissions.includes(...)`,
  `permissionRefusal*(..., 'code')`). A screen that computes its code indirectly reports none, which
  shows up as an empty list rather than as a missing row — read the output, do not count it.
"""
from __future__ import annotations

import os
import re
import sys

# The four the owner named, plus the two that already have a route — kept in the measurement so the
# union for each can be re-checked rather than taken from a commit message.
ENTITIES: dict[str, list[str]] = {
    "insurer": ["insurerId"],
    "policy": ["policyId", "summaryPolicyId"],
    "user": ["ownerUserId", "ownerId", "assigneeUserId", "actorUserId", "userId"],
    "branch": ["branchId"],
    "employee": ["employeeId"],
    "customer": ["customerId"],
}

PERMISSION_PATTERNS = [
    re.compile(r"has(?:Permission)?\(\s*['\"]([a-z0-9.\-]+)['\"]"),
    re.compile(r"permissions\.includes\(\s*['\"]([a-z0-9.\-]+)['\"]"),
    re.compile(r"permissionRefusal\w*\([^)]*?['\"]([a-z0-9.\-]+\.[a-z0-9.\-]+)['\"]"),
]

SCREEN_ROOT = os.path.join("apps", "web", "app", "(app)")


def screen_name(path: str) -> str:
    unixish = path.replace(os.sep, "/")
    return unixish.split("app/(app)/", 1)[1].rsplit("/page.tsx", 1)[0]


def typed_fields(source: str, candidates: list[str]) -> list[str]:
    found = []
    for field in candidates:
        setter = "set" + field[0].upper() + field[1:]
        bound = re.search(r"value=\{" + re.escape(field) + r"\}", source)
        has_setter = re.search(re.escape(setter) + r"\(", source)
        if bound or has_setter:
            found.append(field)
    return found


def permissions(source: str) -> list[str]:
    codes: set[str] = set()
    for pattern in PERMISSION_PATTERNS:
        codes.update(pattern.findall(source))
    return sorted(codes)


def main() -> int:
    if not os.path.isdir(SCREEN_ROOT):
        print(f"no screens at {SCREEN_ROOT} — run this from the repo root", file=sys.stderr)
        return 2

    rows: dict[str, list[tuple[str, list[str], list[str]]]] = {k: [] for k in ENTITIES}
    screens_read = 0
    for root, _dirs, files in os.walk(SCREEN_ROOT):
        if "page.tsx" not in files:
            continue
        path = os.path.join(root, "page.tsx")
        source = open(path, encoding="utf-8").read()
        screens_read += 1
        name = screen_name(path)
        codes = permissions(source)
        for entity, candidates in ENTITIES.items():
            hit = typed_fields(source, candidates)
            if hit:
                rows[entity].append((name, hit, codes))

    # NON-VACUITY. A measurement that read nothing prints a clean report, which is indistinguishable
    # from a measurement that found nothing — the exact failure this repo has hit three times.
    if screens_read < 50:
        print(
            f"ABORT: read only {screens_read} screens. This app has ~102; a number this low means the "
            "walk is pointed at the wrong directory and every count below would be a false zero.",
            file=sys.stderr,
        )
        return 2

    print(f"{screens_read} screens read")
    for entity, candidates in ENTITIES.items():
        hits = sorted(rows[entity])
        print("=" * 96)
        print(f"{entity.upper()}  ({len(hits)} screen(s) type one of {candidates})")
        union: set[str] = set()
        for name, fields, codes in hits:
            shown = ", ".join(codes) if codes else "(no permission code found — READ THIS SCREEN)"
            print(f"  {name:44s} {','.join(fields):26s} {shown}")
            union.update(codes)
        print(f"  -> route gated on ANY OF: {sorted(union) or '(nothing — read the screens above)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
