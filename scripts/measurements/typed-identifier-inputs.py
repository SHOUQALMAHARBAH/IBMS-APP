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

    if not screens:
        print('NOTHING SCANNED — the screen root moved. This is not a clean result.', file=sys.stderr)
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
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
