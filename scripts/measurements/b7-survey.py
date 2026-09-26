# -*- coding: utf-8 -*-
"""B.7 — the formal consistency pass, for the rules a script can decide.

    Usage:  python scripts/measurements/b7-survey.py <out.json>     (from the repo root)

`docs/b7-consistency-record.md` states seven rules, each answerable yes/no/not-applicable per screen.
Three of them are decidable from the source and four are not, and saying which is which is the point of
this script — a survey that guesses at rule 4 is worse than one that declares it unmeasured.

DECIDABLE HERE
  Rule 1  The create form sits ABOVE the table.          — compare source positions of <form> and <table>
  Rule 3  No screen leaves a person facing nothing.       — does the page branch on permission / error /
                                                            empty at all
  Rule 5  One word per concept (the banned synonyms).     — user-facing strings only, via the dictionaries

NOT DECIDABLE HERE, and each for a different reason
  Rule 2  No field asks for an identifier. A label reading "Entity id" is findable, but whether a
          rendered value IS an identifier needs the data shape, not the markup.
  Rule 4  Every refusal names the way forward. Requires reading the sentence.
  Rule 6  Arabic and English say the same THING. Key parity and code-token parity are already gated
          (`translations.test.ts`); meaning is not mechanisable.
  Rule 7  One action, one name, across screens. Needs the glossary decision per concept first — and the
          record is explicit that a term enters the glossary when two screens are found disagreeing,
          which is a judgement, not a grep.

This is a MEASUREMENT, not a gate. It reports; a human decides. See IMPROVEMENTS § 1.44's note on why a
matcher with corrections behind it does not belong behind a red build.
"""
import io, os, re, json, sys

SCREENS = 'apps/web/app'
DICTS = 'apps/web/lib/i18n/translations'

# Rule 5 — the words the glossary forbids for "end an entity's active life". Matched in user-facing
# strings only: a `delete` in code is ordinary, a "Delete" on a button is the violation.
BANNED = ('suspend', 'archive')
# `delete` and `remove` are checked separately: both have legitimate uses (deleting a role that was never
# used is a real, different act the glossary allows; removing a grant is not deactivation).
SOFT = ('delete', 'remove')


def screens():
    out = []
    for root, _, files in os.walk(SCREENS):
        if '.next' in root or 'node_modules' in root:
            continue
        for f in files:
            if f == 'page.tsx':
                out.append(os.path.join(root, f).replace('\\', '/'))
    return sorted(out)


def page_body(src):
    """Only the default-exported component.

    The first version measured the whole file and produced false positives immediately: `audit-trail`
    and three dashboards define a table-rendering HELPER above `export default`, so the file's first
    `<table>` precedes the page's own `<form>` while the screen renders them the other way round. Four
    of eleven reported violations were that, and calibrating three by hand is what found it.
    """
    i = src.find('export default')
    return src[i:] if i != -1 else src


# Rule 1's FIFTH false-positive class, and the one that makes this a candidate list rather than a
# verdict: a multi-section screen has several (form, table) pairs, and the rule is about each PAIR. The
# check compares the FIRST form with the FIRST table, which on these two screens are not a pair.
#
# Both were verified by hand, per pair, and both COMPLY:
#   settings/roles       the first table is the duty-segregation READINESS panel; the create-role form
#                        sits above the roles list, which is the later table.
#   regulatory-compliance the first table displays the single current LICENCE (not a list), and the
#                        create-item form does sit above the items list.
#
# Listing them here rather than "fixing" them is the point: the screens are right and the check is
# coarse. Anything new appearing in rule 1's output needs the same per-pair reading before it is called
# a violation.
MULTI_SECTION_VERIFIED_BY_HAND = {
    '(app)/settings/roles/page.tsx',
    '(app)/regulatory-compliance/page.tsx',
}


def rule1(src):
    """Create form above table. Not-applicable unless the page body has BOTH."""
    body = page_body(src)
    form = body.find('<form')
    table = body.find('<table')
    if form == -1 or table == -1:
        return 'n/a'
    return 'yes' if form < table else 'NO'


def rule3(src):
    """Does the screen branch on each of the three non-data states at all?

    Deliberately shallow: it asks whether a branch EXISTS, not whether its wording is good — that is
    rule 4, which this script does not claim to measure. A screen with no permission branch cannot be
    satisfying rule 3 no matter how the sentence reads.
    """
    missing = []
    if not re.search(r'[Nn]oPermission|hasPermission|403', src):
        missing.append('permission')
    if not re.search(r'[Ll]oadError|[Ee]rror', src):
        missing.append('error')
    if not re.search(r"[Nn]one\b|[Ee]mpty|length === 0|length > 0", src):
        missing.append('empty')
    return 'yes' if not missing else 'NO:' + '+'.join(missing)


def dictionary_strings():
    """Every user-facing string, with its key and file. Both languages."""
    out = []
    for f in sorted(os.listdir(DICTS)):
        if not f.endswith('.ts') or f.endswith('.test.ts'):
            continue
        src = io.open(os.path.join(DICTS, f), encoding='utf-8', errors='replace').read()
        for m in re.finditer(r"^\s{4}([A-Za-z0-9_]+):\s*(['\"])(.*?)\2,?\s*$", src, re.M):
            out.append((f, m.group(1), m.group(3)))
    return out


strings = dictionary_strings()
rule5_hits = []
for f, key, value in strings:
    low = value.lower()
    for word in BANNED:
        if word in low:
            rule5_hits.append((f, key, word, value[:70]))
    for word in SOFT:
        if re.search(r'\b' + word + r'\b', low):
            rule5_hits.append((f, key, word + ' (soft)', value[:70]))

rows = []
for path in screens():
    src = io.open(path, encoding='utf-8', errors='replace').read()
    screen = path.replace('apps/web/app/', '')
    verdict = rule1(src)
    if verdict == 'NO' and screen in MULTI_SECTION_VERIFIED_BY_HAND:
        verdict = 'n/a (multi-section, verified by hand)'
    rows.append({'screen': screen, 'rule1': verdict, 'rule3': rule3(src)})

print('screens surveyed :', len(rows))
print('dictionary strings:', len(strings))
print('')
print('RULE 1 — create form above the table')
for verdict in ('NO', 'yes', 'n/a'):
    n = sum(1 for r in rows if r['rule1'] == verdict)
    print('   {:4s} {}'.format(verdict, n))
print('   VIOLATIONS:')
for r in rows:
    if r['rule1'] == 'NO':
        print('      ', r['screen'])

print('')
print('RULE 3 — the screen branches on permission, error and empty')
n_ok = sum(1 for r in rows if r['rule3'] == 'yes')
print('   yes  {}   incomplete {}'.format(n_ok, len(rows) - n_ok))
print('   INCOMPLETE:')
for r in rows:
    if r['rule3'] != 'yes':
        print('      {:58s} {}'.format(r['screen'], r['rule3']))

print('')
print('RULE 5 — banned synonyms in user-facing strings:', len(rule5_hits))
hard = [h for h in rule5_hits if '(soft)' not in h[2]]
print('   HARD (suspend/archive):', len(hard))
for h in hard:
    print('      {} {} — {}'.format(h[0], h[1], h[3]))

io.open(sys.argv[1], 'w', encoding='utf-8').write(
    json.dumps({'rows': rows, 'rule5': rule5_hits}, indent=1, ensure_ascii=False))
