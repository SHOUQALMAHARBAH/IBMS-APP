# -*- coding: utf-8 -*-
"""Does a load-error message tell the reader what to do? Rule 4, on the state rule 3 calls the fourth.

Rule 3 of `docs/b7-consistency-record.md` ends a screen in one of four states, the fourth being
**"something went wrong" WITH THE WAY TO RETRY**. Rule 4: **every refusal names the way forward.**

The formal pass measured whether the error BRANCH exists — it does, on 89 of 102 screens. What nobody
measured is the half that matters to the person reading it: once they are looking at the failure, are they
told anything they can act on?

## What this does NOT measure, and the measurement it replaced

A first attempt keyed on `commonTryAgain`, the shared key, and reported 4 of 102 — which was TRUE and
useless: 98 screens use a SCREEN-SPECIFIC load-error key, and most of those say "try again" in their own
words. Keying on one key measured which screens share a string, not which screens help a reader.

It also cannot see a RETRY CONTROL. A screen with a Refresh button needs no instruction in its message.
Measured separately: zero screens have one, so today the sentence is the only way forward there is.

Run:  python scripts/measurements/load-error-way-forward.py [--verbose]
"""
import glob
import io
import os
import re
import sys

TRANSLATIONS = os.path.join('apps', 'web', 'lib', 'i18n', 'translations')

ENTRY = re.compile(
    r"^[ \t]*(\w*(?:LoadError|LoadFailed|loadError)\w*)\s*:\s*(?:\n[ \t]*)?(['\"])(.*?)\2,",
    re.M | re.S,
)
WAY_EN = re.compile(r'try again|try once more|retry|reload|refresh|contact|ask ', re.I)
WAY_AR = re.compile('حاول|المحاولة|أعد|تحديث|راجع|اتصل')
ARABIC = re.compile('[؀-ۿ]')


def main():
    verbose = '--verbose' in sys.argv
    rows = {}
    for path in sorted(glob.glob(os.path.join(TRANSLATIONS, '*.ts'))):
        src = io.open(path, encoding='utf-8').read()
        for m in ENTRY.finditer(src):
            key, value = m.group(1), m.group(3)
            lang = 'ar' if ARABIC.search(value) else 'en'
            rows.setdefault(key, {'file': os.path.basename(path)})[lang] = value

    both, one, neither, incomplete = [], [], [], []
    for key in sorted(rows):
        en = rows[key].get('en')
        ar = rows[key].get('ar')
        if en is None or ar is None:
            incomplete.append((key, rows[key]))
            continue
        ok_en = bool(WAY_EN.search(en))
        ok_ar = bool(WAY_AR.search(ar))
        entry = (key, rows[key]['file'], ok_en, ok_ar, en)
        if ok_en and ok_ar:
            both.append(entry)
        elif ok_en or ok_ar:
            one.append(entry)
        else:
            neither.append(entry)

    out = io.TextIOWrapper(io.open(1, 'wb', closefd=False), encoding='utf-8', newline='\n')
    out.write('load-error keys found            %4d\n' % len(rows))
    out.write('  a way forward in BOTH languages %4d\n' % len(both))
    out.write('  in ONE language only            %4d   <-- the bilingual defect: one reader is helped\n' % len(one))
    out.write('  in NEITHER                      %4d\n' % len(neither))
    out.write('  missing a language half         %4d\n' % len(incomplete))

    # A FLOOR. If the extraction silently stops matching, every count above goes to zero and the report
    # reads exactly like a clean result. Four separate measurements were wrong this way before this line
    # existed; it is the difference between "nothing to fix" and "nothing was looked at".
    if len(rows) < 80:
        out.write('\n*** REFUSED: only %d keys found. This codebase has ~109. The extraction has drifted and\n'
                  '*** every number above is meaningless. Blank is not zero.\n' % len(rows))
        out.flush()
        return 1

    for name, group in (('ONE LANGUAGE ONLY', one), ('NEITHER', neither)):
        if not group:
            continue
        out.write('\n%s (%d)\n' % (name, len(group)))
        for key, f, ok_en, ok_ar, en in group:
            out.write('  %-32s %-24s en:%s ar:%s  %s\n'
                      % (key, f, 'y' if ok_en else '.', 'y' if ok_ar else '.', en[:58]))
    if verbose:
        out.write('\nBOTH (%d)\n' % len(both))
        for key, f, _e, _a, en in both:
            out.write('  %-32s %s\n' % (key, en[:70]))
    out.flush()
    return 0


sys.exit(main())
