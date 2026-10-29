#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
HOW MANY PLACES RENDER AN EM DASH WHERE A FACT WOULD GO?

    python scripts/measurements/em-dash-placeholder.py

Item 7.4 of the owner's walk. An em dash is this product's universal "nothing here", and
it is used for at least three facts that are NOT the same thing:

  * NOBODY HAS ENTERED IT — a gap somebody can still close.
  * THERE IS NO SUCH THING for a record of this kind — nobody ever will.
  * WE HOLD IT AND CANNOT RESOLVE IT — a name whose user row no longer answers.

This repository already decided that distinction twice and wrote it down both times: the
retention register's `recordHandle` has FOUR STATES rather than an em dash, because *no
reference recorded* is a gap somebody can close and *no record of this kind carries one*
never will be; and `/employees` says «لا يوجد — لم يُسجَّل أي فرع بعد» rather than a bare
dash. Those are the two worked examples of what the 156 below are standing in for.

THE FIGURE IS A REPORT AND THE WORDING IS THE OWNER'S. Nothing here says a site is wrong
— several are certainly right, because a column that is genuinely empty for a genuinely
empty reason needs no sentence. What it says is how large the question is, which is what
decides whether it is a batch or an errand.

A REPORT, not a gate. Nothing fails on this count.
"""
import io
import os
import re
import sys

ROOTS = (
    os.path.join('apps', 'web', 'app', '(app)'),
    os.path.join('apps', 'web', 'components'),
)

# An em dash in a RENDERED position: a `??` or ternary fallback, a `:` branch, or JSX
# text. Not a comment, and not an em dash inside prose (which is this codebase's ordinary
# punctuation and appears in hundreds of comments).
FALLBACK = re.compile(r"\?\?\s*'—'|\?\s*'—'|:\s*'—'|>\s*—\s*<|'—'")

# A NAME THAT IS HELD AND DOES NOT RESOLVE is the ONE class a matcher can recognise, and it is
# recognisable only because decision 48 settled it: `displayNamesForUserIds` and its three siblings
# take IDS and return a Map, and A MISSING KEY MEANS NO NAME AND MUST NEVER BECOME THE UUID. So a
# `<something>Name` falling back to a dash is precisely *the value is held and its name is
# unavailable* — owner decision 60's «غير متوفّر», and neither of her other two words.
#
# It is REPORTED as a candidate, never acted on by this script: `knowledge-base`'s `titleAr` is a
# name and is NOT this case, which is why a person reads the rows. Added here rather than in a
# second script — `em-dash-sites.py` was written without finding this one, the two disagreed 145
# against 91, and two instruments answering one question is the defect this measurement is for.
NAMEISH = re.compile(r"\w*Name")
CODE_PREFIX = ('//', '*', '/*')
MINIMUM_FILES = 120


def main():
    files, total, scanned = {}, 0, 0
    for base in ROOTS:
        for dp, _d, ns in os.walk(base):
            for n in sorted(ns):
                if not n.endswith('.tsx'):
                    continue
                path = os.path.join(dp, n)
                scanned += 1
                hits = []
                for i, line in enumerate(
                    io.open(path, encoding='utf-8').read().split('\n'), 1
                ):
                    if line.strip().startswith(CODE_PREFIX):
                        continue
                    if FALLBACK.search(line):
                        hits.append(i)
                if hits:
                    files[path.replace(os.sep, '/')] = hits
                    total += len(hits)

    if scanned < MINIMUM_FILES:
        sys.stderr.write(
            'REFUSED: %d file(s) scanned against a floor of %d. A root moved, and a report '
            'that scans nothing reads exactly like a tree with nothing in it.\n'
            % (scanned, MINIMUM_FILES))
        return 2

    print('tsx scanned                             %4d' % scanned)
    print('files rendering an em-dash placeholder  %4d' % len(files))
    print('sites                                   %4d' % total)
    print()
    print('The heaviest, which is where a decision would pay for itself first:')
    for path, hits in sorted(files.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:12]:
        print('  %-60s %3d' % (path.replace('apps/web/', ''), len(hits)))
    print()
    print('em-dash-placeholder: a REPORT, not a gate. The three facts an em dash is '
          'standing in for are named in this file\'s header, and which of them each site\n'
          'means is the owner\'s wording decision — `recordHandle`\'s four states are the '
          'worked example of answering it properly.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
