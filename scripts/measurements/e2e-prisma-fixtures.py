# -*- coding: utf-8 -*-
"""HOW MANY e2e FIXTURES ARE WRITTEN WITH RAW PRISMA, AND WHICH OF THEM COULD GO THROUGH THE API.

    python scripts/measurements/e2e-prisma-fixtures.py

The owner's question: *should those fixtures write through the API instead of Prisma?*

It is a real question rather than a style preference, because a fixture written with raw Prisma can
create a row THE API COULD NOT PRODUCE — and a test standing on such a row is asserting behaviour over
a state the product cannot reach. That has already cost this repo twice:

  * `legacy-import-report.e2e-spec.ts` seeds its first company THROUGH the import endpoint rather than
    with Prisma, specifically so the duplicate check is proven against what the import itself writes.
  * The bulk import turned out to create customers through a path that bypassed the intake DTO, so the
    2000-row path could write rows the new canonical key cannot protect. A Prisma fixture is the same
    shape of hole, in the test layer.

But the opposite is ALSO a real cost, and the answer is not "convert them all":

  * A row in a state the API cannot reach is sometimes exactly the point. A paused SLA timer, an expired
    retention window, a terminated employee back-dated by a year — the test needs the state, not the
    journey, and routing it through HTTP would mean building endpoints to satisfy tests.
  * TEARDOWN has no HTTP equivalent for most models, and a test that cannot clean up leaks into a
    cumulative database. `db-test` is shared across the whole run.
  * A fixture through HTTP needs an actor who HOLDS the permission, so every fixture becomes a role
    decision. That is right for the thing under test and pure cost for its scenery.

So this script does not produce a verdict. It produces the three numbers the verdict needs: how many
writes there are, how many are CREATES (the only ones in question), and how many of those name a model
the API has a creating route for — which is the subset where the conversion is even possible.

## What it CANNOT decide

Whether a possible conversion is WANTED. A `Policy` created through `POST /opportunities/:id/policy`
walks the real placement path and proves more; it also needs an accepted opportunity, a recommendation,
a client decision and a customer, which is four more fixtures to serve one row of scenery. That tradeoff
is per test, and the script says so rather than ranking them.
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter

E2E_DIR = os.path.join("apps", "api", "test")
API_SRC = os.path.join("apps", "api", "src")

WRITE = re.compile(
    r"prisma\.([a-zA-Z][a-zA-Z0-9]*)\.(create|createMany|upsert|update|updateMany|delete|deleteMany)\b"
)

# NO HOOK DETECTION, and the removal is deliberate. A first version tried to tell a write inside
# `afterAll` from one in a test body, so teardown scaffolding would not count as a fixture — and the
# brace counting it needed was wrong on the first nested arrow function. A half-working classifier
# producing a confident number is worse than not classifying at all: the VERB split below already
# separates teardown (`delete`/`deleteMany`) from fixtures, which is the distinction the question turns
# on, and it needs no heuristic.


def creating_routes(candidates: set[str]) -> set[str]:
    """Which of these models does non-test application code create?

    The controllers answer "is there a POST", which is not the question — a POST can create three rows.
    This asks whether application code creates the model AT ALL, because a model nothing creates outside
    a test is a model no amount of routing could reach.

    ## The first version of this function was WRONG in the safe-looking direction

    It anchored on `.client.X.create` / `.tx.X.create`, which misses `tx.claim.create` — a bare `tx`
    inside an interactive transaction, with no dot before it. Result: `claim`, `employee`, `lead` and
    `receipt` were all reported as "nothing in the application creates this", which is false for every
    one of them and would have put four models in a findings list as impossible-to-convert when they are
    the opposite. Caught by reading the output rather than the counts.

    So it now searches for each CANDIDATE by name, which needs no guess about how the client is reached.
    """
    found: set[str] = set()
    sources: list[str] = []
    for root, _dirs, files in os.walk(API_SRC):
        for name in files:
            if not name.endswith(".ts") or name.endswith(".spec.ts"):
                continue
            sources.append(open(os.path.join(root, name), encoding="utf-8").read())
    for model in candidates:
        pattern = re.compile(
            r"\." + re.escape(model) + r"\.(?:create|createMany|upsert)\b"
        )
        if any(pattern.search(source) for source in sources):
            found.add(model)
    return found


def main() -> int:
    if not os.path.isdir(E2E_DIR):
        print(f"no e2e specs at {E2E_DIR} — run from the repo root", file=sys.stderr)
        return 2

    specs = sorted(
        os.path.join(E2E_DIR, f) for f in os.listdir(E2E_DIR) if f.endswith(".e2e-spec.ts")
    )
    by_verb: Counter[str] = Counter()
    by_model: Counter[str] = Counter()
    per_spec: Counter[str] = Counter()

    for spec in specs:
        source = open(spec, encoding="utf-8").read()
        for match in WRITE.finditer(source):
            model, verb = match.group(1), match.group(2)
            by_verb[verb] += 1
            by_model[model] += 1
            per_spec[os.path.basename(spec)] += 1

    total = sum(by_verb.values())
    # NON-VACUITY. A clean report over zero specs is what a wrong path prints, and it reads exactly like
    # a suite with no raw Prisma in it.
    if total == 0 or len(specs) < 50:
        print(
            f"ABORT: {len(specs)} spec(s), {total} write(s). This suite has 100+ specs; a number this "
            "low means the walk or the pattern is wrong and every count below is a false zero.",
            file=sys.stderr,
        )
        return 2

    reachable = creating_routes(set(by_model))
    creates = sum(v for k, v in by_verb.items() if k in ("create", "createMany", "upsert"))
    teardown = sum(v for k, v in by_verb.items() if k in ("delete", "deleteMany"))
    mutations = sum(v for k, v in by_verb.items() if k in ("update", "updateMany"))

    print(f"{len(specs)} e2e spec files, {total} raw Prisma writes")
    print("=" * 92)
    for verb, n in by_verb.most_common():
        print(f"  {verb:12s} {n:5d}")
    print()
    print(f"  CREATES (the only ones in question)        {creates:5d}")
    print(f"  teardown — no HTTP equivalent for most     {teardown:5d}")
    print(f"  state mutations — often the point          {mutations:5d}")
    print()

    # The subset where conversion is even POSSIBLE.
    possible = {m: n for m, n in by_model.items() if m in reachable}
    impossible = {m: n for m, n in by_model.items() if m not in reachable}
    print("=" * 92)
    print(f"MODELS THE APPLICATION ALSO CREATES — conversion is possible here ({len(possible)} models)")
    for model, n in sorted(possible.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {model:40s} {n:4d} write(s) in tests")
    print()
    print(
        f"MODELS NOTHING IN THE APPLICATION CREATES — conversion is IMPOSSIBLE ({len(impossible)} models)"
    )
    print(
        "  These rows cannot be produced through any route, so a test needing one has no alternative to\n"
        "  raw Prisma. Each is also worth a second look for the opposite reason: a model the product\n"
        "  never writes is either scenery or a gap."
    )
    for model, n in sorted(impossible.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {model:40s} {n:4d} write(s) in tests")

    print()
    print("=" * 92)
    print("THE TEN SPECS WITH THE MOST RAW WRITES — where a convention change would be felt")
    for spec, n in per_spec.most_common(10):
        print(f"  {spec:56s} {n:4d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
