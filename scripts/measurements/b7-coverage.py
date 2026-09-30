# -*- coding: utf-8 -*-
"""Which screens a BATCH in `docs/b7-consistency-record.md` names, and which it does not.

## Why this exists

Batches 1-3 of the consistency sweep reported their coverage IN CONVERSATION and never wrote it into the
record. The result was a figure — "76 of 102 remain" — that could not be substantiated: files *touched* is
recoverable from git, but screens *read* is not, because a screen read and found correct touches nothing.

So from batch 4 the record names every screen a batch read, and this script checks that claim by reading the
record rather than by trusting arithmetic. It is the difference between a coverage number anybody can verify
and one that has to be believed.

## The one trap it already fell into

Its first version matched screen names with `[a-z0-9\\-/\\[\\]]+`, which cannot match `(home)` — so it
reported 101 of 102 while the record named all 102. A verification instrument with a false negative is worse
than none, because the number it produces looks like a finding. The pattern now allows parentheses, and the
script FAILS if any screen is unnamed rather than just printing a list.

Run:  python scripts/measurements/b7-coverage.py
"""
import io
import os
import re
import sys

APP = os.path.join('apps', 'web', 'app', '(app)')
RECORD = os.path.join('docs', 'b7-consistency-record.md')

screens = set()
for root, _, files in os.walk(APP):
    if 'page.tsx' in files:
        rel = os.path.relpath(root, APP).replace(os.sep, '/')
        screens.add('(home)' if rel == '.' else rel)

record = io.open(RECORD, encoding='utf-8').read()
named = set()
batches = []
for m in re.finditer(r'^## BATCH (\d+).*?$(.*?)^\|', record, re.M | re.S):
    found = {n for n in re.findall(r'`([a-z0-9()\-/\[\]]+)`', m.group(2)) if n in screens}
    batches.append((m.group(1), len(found)))
    named |= found

missing = sorted(screens - named)
out = io.TextIOWrapper(io.open(1, 'wb', closefd=False), encoding='utf-8', newline='\n')
out.write('screens under app/(app)   %3d\n' % len(screens))
out.write('named in a batch          %3d\n' % len(named))
for num, count in batches:
    out.write('    batch %-2s %3d\n' % (num, count))
out.write('NOT named                 %3d\n' % len(missing))
for s in missing:
    out.write('    %s\n' % s)
if missing:
    out.write('\nFAIL — a screen exists that no batch names. Either it was never read, or a batch read it and\n'
              'did not list it; both are the same defect from outside, which is why this fails rather than\n'
              'printing a note.\n')
out.flush()
sys.exit(1 if missing else 0)
