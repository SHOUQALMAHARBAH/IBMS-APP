# -*- coding: utf-8 -*-
"""Absence assertions that could be satisfied by a read that has not landed yet.

`toHaveCount(0)` SUCCEEDS ON ITS FIRST POLL rather than waiting out its timeout. So an element that
WILL exist once an in-flight read resolves satisfies it, and the verdict then depends on machine
load — measured 2026-09-28, a planted regression died under the full spec and PASSED when its test
ran alone, on the identical build.

## The predicate is much narrower than "the test mocks several reads"

Worked out by hand over the four sites a coarse proxy flagged, and NONE of them was at risk. Four
different reasons, each of which narrows the class:

1. `customers.spec.ts` — the read that would produce the absent value had not been MADE yet (the
   submit happens after), so nothing could arrive late.
2. `leads.spec.ts` — the element would DISAPPEAR, not appear. `toHaveCount(0)` retries, so for that
   direction it waits correctly; the race is appear-late only.
3. `part-g-core-screens.spec.ts` — "not yet" IS the intended claim: a loading-state capture,
   anchored on the loading indicator, which is the right anchor for it.
4. `four-state-screenshots.spec.ts` — the mock for the read in question returns `[]`, so the
   element is absent before AND after it lands. Same verdict either way.

So the real predicate is: **an absence claimed for a reason other than the data being empty, while
the data that would produce it is present and still loading.** Whether a mocked response would
produce a given element is not decidable from the source — it needs the component's render logic —
so THIS SCRIPT DOES NOT DECIDE. It reports the shape for a person to read, which is the honest
shape for a check that cannot be exact: a narrow honest report beats a broad gate that quietly
finds nothing.

The rule itself is pinned by `apps/web/e2e/anchored-helper.spec.ts`, which also holds a permanent
disproof of the tempting wrong fix — `waitForLoadState('networkidle')` is a SNAPSHOT, and idleness
is exactly the state between two sequential reads.

## Three classifier bugs are recorded here, because each produced a confident wrong number

1. Splitting the source on `\\ntest(` sees only TOP-LEVEL tests, so every test nested in a
   `describe` was skipped and the total was an undercount (145 against 169).
2. `expectNone(` contains neither `toHaveCount(0)` nor `not.toBeVisible()`, so omitting it from the
   negative pattern made the helper count structurally unable to be anything but zero.
3. A raw regex count over the whole tree gives a third number again, because an import line matches
   and one statement can carry two spellings.

Run:  python scripts/measurements/absence-assertion-risk.py
"""
import io
import os
import re
import sys

E2E = os.path.join('apps', 'web', 'e2e')

TEST_START = re.compile(r'^\s*(?:test|it)(?:\.skip|\.fixme|\.only)?\s*\(')
NEGATIVE = re.compile(r'toHaveCount\(\s*0\s*\)|not\.toBeVisible\(\)|\bexpectNone\s*\(')
HELPER = re.compile(r'\bexpectNone\s*\(')
ROUTE = re.compile(r'\bpage\.route\s*\(')
IMPORT = re.compile(r'^\s*import\b')
# A mocked response that carries NOTHING. An absence assertion against an empty read reaches the
# same verdict whether or not the read has landed, which is what took the fourth site off the list.
EMPTY_JSON = re.compile(r'json:\s*(\[\s*\]|\{\s*\}|paged\(\s*\[\s*\]\s*\)|null)')


def specs():
    for root, _, files in os.walk(E2E):
        for name in sorted(files):
            if name.endswith('.spec.ts'):
                yield os.path.join(root, name)


def main():
    total = helper = raw = 0
    review = []

    for path in specs():
        lines = io.open(path, encoding='utf-8', errors='replace').read().split('\n')
        routes = 0
        empties = 0
        in_test = False
        for number, line in enumerate(lines, start=1):
            if TEST_START.search(line):
                in_test, routes, empties = True, 0, 0
            if ROUTE.search(line):
                routes += 1
            if EMPTY_JSON.search(line):
                empties += 1
            if IMPORT.search(line):
                continue
            if not NEGATIVE.search(line):
                continue
            total += 1
            if HELPER.search(line):
                helper += 1
                continue
            raw += 1
            # Worth a human read only when the test mocks several reads AND at least one of them
            # returns data — an all-empty test cannot produce the element late.
            if in_test and routes > 2 and empties < routes - 1:
                review.append((os.path.basename(path), number))

    print('absence assertions in the web suite          %4d' % total)
    print('  through expectNone()                       %4d' % helper)
    print('  raw toHaveCount(0) / not.toBeVisible       %4d' % raw)
    print('    several reads, at least one non-empty    %4d   <- READ THESE BY HAND' % len(review))
    if review:
        print()
        print('for review (a shape, NOT a finding):')
        for name, number in review:
            print('  %-42s :%d' % (name, number))
    print()
    print('Ask of each: would the absent element be produced by data one of these mocks')
    print('actually returns? If yes, anchor on that read. If no, it is not at risk.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
