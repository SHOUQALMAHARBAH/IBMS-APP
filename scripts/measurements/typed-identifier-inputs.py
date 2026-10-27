"""WHICH SCREENS ASK A PERSON TO TYPE A RAW IDENTIFIER.

A different defect from `rendered-identifiers.py`, and a worse one. That script finds an id a reader
SEES in a cell: ugly, uninformative, but the screen still works. This one finds an id a person must
TYPE IN, which is the defect `EntitySearch` was built to remove — "nobody knows a uuid, so the only way
to fill one in was to open another screen and copy it out of the address bar". Where the input is
`required`, the screen cannot be used at all without one.

The owner named thirteen screens as showing "an id" and asked what an employee is supposed to do with
one. Nine of the thirteen render no identifier at all by the other script's reckoning — because what
they actually have is this: a text box wanting a uuid. Two different fixes, so two different lists.

## What counts

A `<input>` whose bound state variable is identifier-shaped (`somethingId`), inside a form. Reported
with whether it is `required`, because that is the line between "awkward" and "unusable".

## What is deliberately NOT counted

A `<select>` bound to an id. A select OFFERS its options, so the id is the value and the label is a
name — which is the correct shape and is what this script's findings should become. Counting those
would bury the real finding under every working picker in the app.

## Two VERIFIED-BY-HAND false positives, excluded by name rather than by pattern

Both are an identifier a person genuinely knows and should type, which is the opposite of the defect:

  * `employees` — `nationalId` on the person-registration form. A number read off a document.
  * `settings/email` — `tenantId`, a Microsoft 365 tenant an administrator pastes from Azure.

Excluded by name, not by a cleverer regex, because the thing that separates them from a finding is
what the value MEANS to the person typing it, which no pattern can see. A third of this kind gets
added here with its reason, so the exclusion list stays readable as a list of judgements.

Blind spots, stated so the next reader starts ahead rather than trusting a zero:
  1. An input whose state variable is not named `*Id` (`const [who, setWho]`) is invisible here.
  2. An input bound to a field of an object (`value={form.employeeId}`) is matched only if the
     trailing segment is id-shaped.
  3. A screen taking an id from the URL rather than a form is out of scope — and is usually correct,
     because a link carries the id and the reader never types it.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCREENS = ROOT / 'apps' / 'web' / 'app' / '(app)'

# `value={employeeId}` / `value={form.insurerId}` — the trailing segment must end in Id.
VALUE_BINDING = re.compile(r'value=\{([A-Za-z0-9_.]*?[A-Za-z0-9_]*[Ii]d)\}')
INPUT_OPEN = re.compile(r'<input\b')
SELECT_OPEN = re.compile(r'<select\b')

# See the header: an identifier the person typing it genuinely knows. Judgements, not patterns.
HAND_VERIFIED_CORRECT = {
    ('employees', 'nationalId'),
    ('settings/email', 'tenantId'),
}


# ---------------------------------------------------------------------------- the ratchet
#
# TWO budgets, not one, because the two numbers mean different things and the smaller one is the
# serious one. An OPTIONAL typed identifier is awkward: the screen works, the filter is unusable.
# A REQUIRED one means a person CANNOT COMPLETE THE FORM without pasting a machine code by hand —
# the screen is unusable, which is the owner's rule 90 in its sharpest form.
#
# So `REQUIRED_TYPED_IDENTIFIER_BUDGET` is gated separately and must reach 0. Folding it into the
# total would let a required field be traded for an optional one and keep the gate green, which is
# the one move that must not be silent.
#
# Both fail in BOTH directions. Measured 2026-10-22 across 106 screens; both figures matched the
# screen-pass measurement document's own.
# 26 -> 12 (module 0-c, group 6): the owner's walk, and the whole fall was WIRING.
# `EntitySearch`, `GET /admin/branches/search` and a gate naming six dashboard codes all
# shipped, and `branch` was a source with ZERO CONSUMERS — fourteen sites across eight
# screens typed a uuid into a field whose chooser was already built and already reachable
# by every role (`picker-route-reachability.mjs`: 0 stuck). No route, no gate and no
# permission moved. What remains is measured in `typed-identifier-sources.py`: seven need
# a search route, two are PARTLY closed, one is CORRECT by decision 41, one is blocked on
# a grant decision of the owner's, and one can never be closed by a picker at all.
TYPED_IDENTIFIER_BUDGET = 12
#
# 2 -> 0 on 2026-10-23, owner decision 41, and it is now a FLAT BAN with no switch to throw.
#
# Both required typed identifiers sat on `/audit-trail`: `wfEntityId` on the workflow-history section and
# `documentId` on the document-history one. Each is still an input and still appears in the TOTAL below,
# because manual typing stays possible — what changed is that the screen no longer DEMANDS it. The normal
# way they get filled is navigation: every screen whose rows carry a workflow state links to
# `/audit-trail?entityType=&entityId=`, so that field arrives filled by where the reader came from. A
# chooser fills either field, on the two entities whose search route the readers of that screen can
# actually reach. **`documentId` HAS NO INBOUND LINK — corrected, because this comment first claimed
# `/documents` provides one.** No screen links to `?documentId=`: A3 scoped the links to the eighteen
# WORKFLOW entity types and `Document` is not one. For a `document.read` holder the chooser fills it; for
# the EXTERNAL_AUDITOR it is typed, with the ids visible in the audit-log table on the same screen.
#
# THE TOTAL DID NOT MOVE AND THAT IS THE HONEST RESULT: 26 before, 26 after. A screen a person cannot
# complete and a screen that offers an optional id filter are different faults, which is the whole reason
# this count is gated apart from that one. Do not raise this number.
REQUIRED_TYPED_IDENTIFIER_BUDGET = 0

# A count floor rather than `if not screens`. Zero screens is the obvious drift; 40 screens is the
# one that reads like progress. Blank is not zero.
MINIMUM_SCREENS_SCANNED = 90


def main() -> int:
    rows: list[tuple[str, int, str, bool]] = []
    screens = sorted(SCREENS.rglob('page.tsx'))
    for path in screens:
        text = path.read_text(encoding='utf-8')
        lines = text.split('\n')
        for i, line in enumerate(lines):
            if not INPUT_OPEN.search(line):
                continue
            # The element's attributes may wrap over several lines; read to the closing bracket.
            chunk = '\n'.join(lines[i : i + 8])
            end = chunk.find('/>')
            if end == -1:
                end = chunk.find('>')
            element = chunk[: end + 1] if end != -1 else chunk
            if SELECT_OPEN.search(element):
                continue
            match = VALUE_BINDING.search(element)
            if not match:
                continue
            name = match.group(1)
            # `*.id` on a record being rendered is not a typed-in identifier.
            if name.endswith('.id'):
                continue
            screen_name = str(path.relative_to(SCREENS).parent).replace('\\', '/')
            if (screen_name, name) in HAND_VERIFIED_CORRECT:
                continue
            rows.append(
                (
                    str(path.relative_to(SCREENS).parent).replace('\\', '/'),
                    i + 1,
                    name,
                    'required' in element,
                )
            )

    if len(screens) < MINIMUM_SCREENS_SCANNED:
        print(
            'NOTHING SCANNED — only %d screen(s) against a floor of %d. The screen root moved. '
            'This is not a clean result.' % (len(screens), MINIMUM_SCREENS_SCANNED),
            file=sys.stderr,
        )
        return 1

    by_screen: dict[str, list[tuple[int, str, bool]]] = {}
    for screen, line, name, required in rows:
        by_screen.setdefault(screen, []).append((line, name, required))

    for screen in sorted(by_screen):
        print(f'{screen:<42} {len(by_screen[screen])}')
        for line, name, required in by_screen[screen]:
            flag = 'REQUIRED — screen unusable without it' if required else 'optional filter'
            print(f'      L{line:<5} value={{{name}}}   {flag}')

    print()
    print(f'{"screens scanned":<38} {len(screens)}')
    print(f'{"screens asking for a typed identifier":<38} {len(by_screen)}')
    print(f'{"typed identifier inputs":<38} {len(rows)}')
    print(f'{"of those, REQUIRED":<38} {sum(1 for r in rows if r[3])}')

    if '--check' not in sys.argv:
        return 0

    total = len(rows)
    required = sum(1 for r in rows if r[3])
    failed = False

    # THE REQUIRED CLASS FIRST — it is the one that stops the work, so it is reported first and on
    # its own terms. A reader who sees only the total would read "26 against 26" as steady state and
    # miss that two screens cannot be used at all.
    if required > REQUIRED_TYPED_IDENTIFIER_BUDGET:
        print(
            f'\ntyped-identifier-inputs: FAILED — {required} REQUIRED typed identifier(s) against a '
            f'budget of {REQUIRED_TYPED_IDENTIFIER_BUDGET}.'
        )
        print(
            'A required identifier input means the form cannot be submitted without pasting a uuid, '
            'so the screen is not usable by anybody who does not already have another screen open.'
        )
        print(
            'Give it a chooser: add a SOURCE to `ENTITY_SOURCES` and gate its search route on ANY OF '
            'the permissions of the screens that use it (`common/picker-search.config.ts`). Run '
            '`picker-route-permissions.py` and `picker-route-reachability.mjs` after — a chooser '
            'calling a route the role cannot reach turns this fault into an unreachable route.'
        )
        failed = True
    elif required < REQUIRED_TYPED_IDENTIFIER_BUDGET:
        print(
            f'\ntyped-identifier-inputs: FAILED — only {required} REQUIRED remain, so lower '
            f'REQUIRED_TYPED_IDENTIFIER_BUDGET to {required}.'
        )
        print('At 0 it is a flat ban: no screen may ship unusable without a pasted identifier.')
        failed = True

    if total > TYPED_IDENTIFIER_BUDGET:
        print(
            f'\ntyped-identifier-inputs: FAILED — {total} typed identifier input(s) against a budget '
            f'of {TYPED_IDENTIFIER_BUDGET}.'
        )
        print(
            'Nobody knows a uuid. An optional one makes a filter unusable rather than the screen, '
            'which is why it is the larger budget and not the urgent one — but it only falls.'
        )
        print('Do NOT raise the budget: the owner struck attrition.')
        failed = True
    elif total < TYPED_IDENTIFIER_BUDGET:
        print(
            f'\ntyped-identifier-inputs: FAILED — only {total} remain, so lower '
            f'TYPED_IDENTIFIER_BUDGET to {total}.'
        )
        print('This half is what stops the ratchet becoming a ceiling.')
        failed = True

    if failed:
        return 1

    print(
        f'\ntyped-identifier-inputs: at its declared budgets — {TYPED_IDENTIFIER_BUDGET} typed, '
        f'{REQUIRED_TYPED_IDENTIFIER_BUDGET} of them REQUIRED.'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
