#!/usr/bin/env python3
"""Which api e2e tests claim a CAPABILITY in their title and assert only a STATUS CODE?

## WHY THIS EXISTS

`picker-search-gates.e2e-spec.ts` carried a test titled `THE DPO CAN NOW FIND A CUSTOMER - their
own screen`. It asserted `.expect(200)` and nothing about the body. With the owner filter in place
the DPO got 200 with an EMPTY ARRAY - so that test passed throughout the entire period the DPO
could find nothing, while its own title said the opposite. The title was the promise and the status
code was the enforcement, and they were different claims.

That is a CLASS, not an incident: a 2xx proves the route ADMITTED the caller and nothing more. For
a read, *admitted* and *answered* are different facts; for a write, *accepted* and *stored* are.

## THE RULE, AND THE ONE I TRIED FIRST THAT COULD NOT SEE ITS OWN MOTIVATING CASE

A claiming test is weak when **no assertion anywhere in it reads a response body**.

That is the SECOND rule. The first weighed only the LAST request in each test, on the reasonable
ground that an earlier 2xx is often a precondition for what follows. **It excluded the very test
this script was written from**: the pre-fix `THE DPO CAN NOW FIND A CUSTOMER` asserted its 200
FIRST and then asserted two `400`s for the three-character floor, so its last status was a refusal
and a positive control against the pre-fix file reported ZERO.

An instrument that cannot find the defect it was built for cannot be trusted about the hundreds of
tests it reports nothing on - the `??`-read-as-a-ternary class in a new script. **The positive
control is what caught it. Run one before trusting any figure here**: check out the pre-fix file
(`git show d983269:apps/api/test/picker-search-gates.e2e-spec.ts`) and confirm this script reports
`THE DPO CAN NOW FIND A CUSTOMER` against it.

## WHAT IT CANNOT DECIDE

It is a REPORT, not a gate, because the judgement it needs is not mechanical:

  - A test whose subject IS the status code is CORRECT with no body assertion. Refusals
    (`403`/`404`/`422`/`400`/`409`) are exactly that, so a test with no 2xx at all is excluded, and
    titles whose own words name a refusal are excluded too.
  - A test may assert the DATABASE rather than the response - often the STRONGER assertion. Those
    are reported in their own section rather than lumped in, because they are not the defect.
  - A 2xx can legitimately be a precondition for a later assertion that happens not to read a
    body - a count, a screen, a second request's status.

So every row needs reading by a person. The number is a starting point, not a finding, which is the
same honesty `dead-client-helpers.py` and `raw-stored-values.py` carry in their own headers.

    python scripts/measurements/status-code-only-assertions.py
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
E2E = ROOT / "apps" / "api" / "test"

# A title that CLAIMS something a status code cannot prove - verbs of capability and of outcome.
CLAIM = re.compile(
    r"\b(can|now|returns?|lists?|shows?|carries|names?|finds?|stores?|records?|writes?|"
    r"reaches|surfaces|answers?|reports?|includes?|resolves?)\b",
    re.I,
)
# Titles whose subject IS the refusal. Excluded: there the status code is the claim.
REFUSAL = re.compile(
    r"\b(refus\w*|reject\w*|403|404|422|400|409|forbid\w*|denies|denied|cannot|must not|"
    r"never|blocks?|blocked|unauthoris\w*|unauthoriz\w*)\b",
    re.I,
)

IT = re.compile(r"^\s*it\(\s*(['\"`])(.*?)\1", re.S)
STATUS = re.compile(r"\.expect\((\d{3})\)")
READS_BODY = re.compile(r"\.body\b")
READS_DB = re.compile(r"\b(prisma|rawPrisma)\.\w+\.(find|count)")


def tests(source: str) -> list[tuple[str, str]]:
    """Each `it('title', ...)` with its body, sliced to the next `it(`."""
    out: list[tuple[str, str]] = []
    starts = [m.start() for m in re.finditer(r"^\s*it\(", source, re.M)]
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(source)
        block = source[start:end]
        found = IT.match(block)
        if found:
            out.append((found.group(2).replace("\n", " ").strip(), block))
    return out


def classify(source: str, name: str):
    """-> (tests, claiming, weak rows, db-only rows) for one file's source."""
    # Comments stripped: a title quoted in a comment is not a test, and a commented-out assertion
    # is not an assertion. The recorded lesson from `check:seed-sweeps`.
    code = re.sub(r"/\*[\s\S]*?\*/", " ", source)
    code = re.sub(r"(^|[^:])//[^\n]*", r"\1 ", code)
    total = claiming = 0
    weak: list[tuple[str, str]] = []
    db_only: list[tuple[str, str]] = []
    for title, block in tests(code):
        total += 1
        if not CLAIM.search(title) or REFUSAL.search(title):
            continue
        claiming += 1
        statuses = [m.group(1) for m in STATUS.finditer(block)]
        if not any(s.startswith("2") for s in statuses):
            continue
        if READS_BODY.search(block):
            continue
        (db_only if READS_DB.search(block) else weak).append((name, title))
    return total, claiming, weak, db_only


def main() -> int:
    if not E2E.is_dir():
        print(f"no api e2e directory at {E2E}", file=sys.stderr)
        return 2

    files = sorted(E2E.glob("*.e2e-spec.ts"))
    total = claiming = 0
    weak: list[tuple[str, str]] = []
    db_only: list[tuple[str, str]] = []
    for path in files:
        t, c, w, d = classify(path.read_text(encoding="utf-8"), path.name)
        total += t
        claiming += c
        weak += w
        db_only += d

    # THE NON-VACUITY FLOOR. A parser that stops matching reports a clean nothing, which is the
    # shape this repository has paid for repeatedly - and this script's own first rule produced
    # exactly that against its positive control.
    if total < 500 or claiming < 50:
        print(
            f"FAILED: parsed {total} test(s) and {claiming} claiming title(s) across "
            f"{len(files)} file(s) - too few to be a real reading. The parser broke; it is not "
            f"that the suite shrank.",
            file=sys.stderr,
        )
        return 1

    print(f"api e2e spec files                      {len(files)}")
    print(f"tests                                   {total}")
    print(f"of those, titles CLAIMING a capability  {claiming}")
    print()
    print(f"NO ASSERTION READS A RESPONSE BODY      {len(weak)}")
    for name, title in weak:
        print(f"    {name:<46} {title[:94]}")
    print()
    print(f"assert the DATABASE instead             {len(db_only)}  (often STRONGER - read, do not fix)")
    for name, title in db_only:
        print(f"    {name:<46} {title[:94]}")
    print()
    print("A 2xx proves the route ADMITTED the caller. For a read, *admitted* and *answered* are")
    print("different facts; for a write, *accepted* and *stored* are. Every row needs reading - this")
    print("is a REPORT and not a gate, because a test whose subject IS the status code is correct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
