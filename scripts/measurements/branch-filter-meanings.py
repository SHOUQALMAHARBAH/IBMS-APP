"""One filter labelled "show one branch only" resolves against FOUR different fields.

WHY THIS EXISTS. A manager filtering two dashboards by the same branch is shown two different
sets of people and has nothing on the screen to tell them apart. Nothing is broken; the numbers
are simply answers to different questions under one label.

THE OWNER'S RULE THIS SERVES: a name is derived from the context of its own sentence by
MEASUREMENT, not translated. So this script produces the {site - meaning - label} table rather
than anybody writing one by hand, and it is re-runnable, which a hand-written table is not.

## WHY A SCRIPT AND NOT A GREP, which is the whole reason the first two counts were wrong

Two matcher blind spots produced two wrong figures in one day, both UNDER-reporting:

  * `invoice.repository.ts` resolves the filter in RAW SQL (`p."placedByUserId" = ANY(...)`),
    which no Prisma-argument-object pattern can see. First count: 9 instead of 10.
  * `employee-performance.repository.ts` takes the branch under its OWN parameter name
    (`filter.branchId`) rather than the shared `ownerUserIds`, so a grep anchored on the shared
    name cannot reach it either.
  * And the third was not a count but a MEANING: `ownerUserId: { in: ... }` was read as "the
    customer file's owner" everywhere, when `sales-dashboard` and `sales-performance` apply it
    to `Lead` and `Prospect`. A field name is not a meaning — the MODEL decides.
  * And the FOURTH, caught only when the owner's label for that meaning named PROSPECTS and the
    measurement did not: `Prospect` carries `salesOwnerUserId`, so the pattern anchored on a
    lowercase `o` could not see `sales-performance.repository.ts:104`. Four counts for one item,
    every one UNDER — which is the direction that looks clean.

## WHY `--check` HAS DECLARED TOTALS

Because "a script that fails when its own total moves" is what this was credited for being, and
the first version only PRINTED. A report nobody compares against anything is a number, not a
guard: the four under-counts above were all found by a person noticing, which is exactly what a
declared total removes. Raise or lower EXPECTED deliberately, in the commit that moves it.

So the patterns below are declared WITH the model they belong to, and the script fails if its own
total moves without the table being updated.

    python scripts/measurements/branch-filter-meanings.py
    python scripts/measurements/branch-filter-meanings.py --check
"""

from __future__ import annotations

import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPOS = pathlib.Path("apps/api/src/repositories")
SERVICES = pathlib.Path("apps/api/src/modules")

# ---------------------------------------------------------------- the four meanings
#
# Keyed by the FIELD the branch's users are matched against, because that is what decides whose
# branch the reader is actually being shown.
MEANINGS = {
    "POLICY_PLACER": "the branch of whoever PLACED the policy (Policy.placedByUserId)",
    "CUSTOMER_OWNER": "the branch of whoever owns the CUSTOMER file (Customer.ownerUserId)",
    "LEAD_OWNER": "the branch of whoever owns the LEAD or PROSPECT file (Lead/Prospect.ownerUserId)",
    "EMPLOYEE_SELF": "the EMPLOYEE'S OWN branch (Employee.user.branchId)",
}

# Each pattern is anchored on the EXPRESSION, not on a field name, so a field reused on another
# model cannot be silently folded into the wrong meaning.
PATTERNS: list[tuple[str, str, str]] = [
    # (meaning, regex over one line, why this shape and not a looser one)
    (
        "POLICY_PLACER",
        r"placedByUserId: \{ in: [A-Za-z]+\.ownerUserIds",
        "Prisma argument object on Policy",
    ),
    (
        "POLICY_PLACER",
        r'p\."placedByUserId" = ANY\(',
        "RAW SQL — invisible to every object-shaped matcher, and the reason the first count was 9",
    ),
    (
        "CUSTOMER_OWNER",
        r"customer: \{ (?:is: \{ )?ownerUserId: \{ in: [A-Za-z]+\.ownerUserIds",
        "nested through the customer relation",
    ),
    (
        "EMPLOYEE_SELF",
        r"employee: \{ user: \{ is: \{ branchId:",
        "its OWN parameter name, not the shared ownerUserIds",
    ),
]

# `ownerUserId: { in: ... }` is AMBIGUOUS on its own — it is Customer on one screen and Lead or
# Prospect on another — so it is resolved by reading the model off the enclosing query instead of
# by pattern. This is the one that produced a wrong MEANING rather than a wrong count.
# ...and the FIELD NAME ITSELF VARIES, which is a fourth under-count in one item: `Prospect`
# carries `salesOwnerUserId`, not `ownerUserId`, so a pattern anchored on a lowercase `o` skipped
# `sales-performance.repository.ts:104` entirely. The owner's label for this meaning names
# prospects explicitly; the measurement did not, until it was asked to.
BARE_OWNER = re.compile(
    r"(?:sales)?[Oo]wnerUserId: \{ in: [A-Za-z]+(?:\.ownerUserIds)?"
)
MODEL_CALL = re.compile(r"this\.prisma\.client\.([A-Za-z]+)\.")

CUSTOMER_MODELS = {"customer"}
LEAD_MODELS = {"lead", "prospect"}

# The services that DERIVE the filter from a branchId. A repository only ever sees the filter
# because one of these built it, so this is the set of screens a label belongs to.
BRANCH_DERIVING = "findUserIdsInBranch"


def model_above(lines: list[str], i: int) -> str | None:
    """The Prisma model of the query this line sits inside — read UPWARD from the match."""
    for j in range(i, max(-1, i - 40), -1):
        m = MODEL_CALL.search(lines[j])
        if m:
            return m.group(1)
    return None


def scan() -> dict[str, list[tuple[str, int, str]]]:
    found: dict[str, list[tuple[str, int, str]]] = {k: [] for k in MEANINGS}
    for path in sorted(REPOS.glob("*.repository.ts")):
        lines = path.read_text(encoding="utf-8").splitlines()
        rel = path.name
        for i, line in enumerate(lines):
            for meaning, pattern, _why in PATTERNS:
                if re.search(pattern, line):
                    found[meaning].append((rel, i + 1, line.strip()[:80]))
            if BARE_OWNER.search(line) and "customer:" not in line:
                model = (model_above(lines, i) or "").lower()
                if model in CUSTOMER_MODELS:
                    found["CUSTOMER_OWNER"].append((rel, i + 1, line.strip()[:80]))
                elif model in LEAD_MODELS:
                    found["LEAD_OWNER"].append((rel, i + 1, line.strip()[:80]))
                else:
                    # Refuse rather than guess: an unrecognised model is a NEW meaning or a
                    # matcher that has gone blind, and both need a person.
                    found.setdefault("UNRESOLVED", []).append(
                        (rel, i + 1, f"model={model or '?'}  {line.strip()[:60]}")
                    )
    return found


def branch_deriving_services() -> list[str]:
    out = []
    for path in sorted(SERVICES.rglob("*.service.ts")):
        if BRANCH_DERIVING in path.read_text(encoding="utf-8"):
            out.append(path.name)
    return out


# Measured 2026-11-04. Change these in the commit that changes the tree, never to make a run pass.
EXPECTED_SITES = 19
EXPECTED_REPOS = 10
EXPECTED_PER_MEANING = {
    "POLICY_PLACER": 9,
    "CUSTOMER_OWNER": 5,
    "LEAD_OWNER": 4,
    "EMPLOYEE_SELF": 1,
}


def main() -> int:
    check = "--check" in sys.argv
    found = scan()

    unresolved = found.pop("UNRESOLVED", [])
    total = sum(len(v) for v in found.values())
    repos = {r for v in found.values() for r, _, _ in v}

    print(f"meanings declared        : {len(MEANINGS)}")
    print(f"resolution sites         : {total}")
    print(f"repositories involved    : {len(repos)}")
    print()
    for key, label in MEANINGS.items():
        rows = found[key]
        print(f"{key}  ({len(rows)} site(s))  -- {label}")
        for rel, ln, text in rows:
            print(f"    {rel}:{ln}")
        print()

    svcs = branch_deriving_services()
    print(f"services deriving the filter from a branchId : {len(svcs)}")
    for s in svcs:
        print(f"    {s}")

    if unresolved:
        print()
        print("REFUSED — a site whose model this script could not name:")
        for rel, ln, text in unresolved:
            print(f"    {rel}:{ln}  {text}")
        print("A field name is not a meaning. Name the model, then add it to MEANINGS.")
        return 1

    # NON-VACUITY. A pattern set that silently stops matching reports a clean nothing, which is
    # indistinguishable from a product with one unambiguous filter.
    if total == 0:
        print()
        print("REFUSED: no resolution site matched at all — the matcher broke, not the tree.")
        return 1

    if check:
        print()
        drift = []
        if total != EXPECTED_SITES:
            drift.append(f"sites {total} != declared {EXPECTED_SITES}")
        if len(repos) != EXPECTED_REPOS:
            drift.append(f"repositories {len(repos)} != declared {EXPECTED_REPOS}")
        for key, n in EXPECTED_PER_MEANING.items():
            got = len(found[key])
            if got != n:
                drift.append(f"{key} {got} != declared {n}")
        if drift:
            print("FAIL: the measurement moved and the declaration did not.")
            for d in drift:
                print(f"    {d}")
            print()
            print("A site APPEARING is a new place one label answers two questions; a site")
            print("DISAPPEARING is one that now carries its own. Both are decisions, so update")
            print("EXPECTED in the commit that causes them — never to make this run pass.")
            return 1
        print(f"OK: {total} sites across {len(repos)} repositories, at the declared figures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
