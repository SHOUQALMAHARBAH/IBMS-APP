# -*- coding: utf-8 -*-
"""Which of the four states a screen actually has — rules 1 and 3 of `docs/b7-consistency-record.md`.

Rule 3: "No screen leaves a person facing nothing. Every screen ends in one of four states: data · 'no
data' with the create action · 'you do not have permission' with the reason · 'something went wrong' with
the way to retry."

## THIS SCRIPT PROPOSES; THE READING DISPOSES

Batch 4 ran it over 20 screens, it flagged three, and **all three were false positives**. Each one taught it
something, and the first two are why the header is this long:

  1. **A rendering HELPER defined above `export default`.** `/audit-trail` defines `AuditLogTable` at the
     top of the file, so its `<table>` sits at line 93 and the browse FORM at line 300 — which reads as
     "form below table" and is not. The formal pass hit this same class on `/audit-trail` and three
     dashboards. Rule 1 offsets are therefore printed, never judged.

  2. **An error state that is not called `loadError`.** `/audit-trail` has `browseError`, `wfError` and
     `docError` — three, because it loads three independent things. A fixed name list reported the screen
     as having no error branch at all.

  3. **THE FOUR STATES CAN LIVE IN A CHILD COMPONENT.** `/access-recertification` renders its empty state
     inside `RecertificationItemsTable`, so the page file has no empty-state signal and the screen is
     correct. This script now follows local component imports one level deep, which fixes the count but
     does NOT make it reliable: a state two components down is still invisible.

  4. **A FILTER FORM ABOVE THE TABLE MASKS A CREATE FORM BELOW IT** — batch 6, and the only one of these
     that hid REAL violations rather than producing noise. The formal pass reported rule 1 as *0 violations*
     while `/vendors` had `onSearchSubmit` above the list and `onCreate` below it, and `/employees/[id]` had
     its training table above the form that records a training. A first-form-vs-first-table comparison is
     satisfied by the filter form, so the create form's position is never examined.

     The pass had documented "a filter form was mistaken for a create form" as a FALSE-POSITIVE class and
     corrected for it. That correction is what created this blind spot: telling the two apart stopped the
     noise and also stopped the check looking at the one that matters. Both are found now by comparing
     CREATE-form offsets against table offsets separately, keyed on the submit handler's name.

**So a flag here is a worklist row, not a finding.** A detail page has no "empty"; a create-only screen has
no table; a read-only screen has no form. None of those is a violation.

Run:  python scripts/measurements/four-states.py [<screen> ...]
"""
import io
import os
import re
import sys

WEB = os.path.join('apps', 'web')
APP = os.path.join(WEB, 'app', '(app)')

LOADING = re.compile(r'\bisLoading\b|\bloading\b|commonLoading|Loading\b')
EMPTY = re.compile(r'None(?:Yet|Match)?\b|\bEmpty\b|\.length\s*===\s*0')
# Any state whose name ends in Error/Failed — `/audit-trail` has three and none is called `loadError`.
ERROR = re.compile(r'\b\w*(?:[Ee]rror|[Ff]ailed)\b\s*\?|\{\s*\w*(?:[Ee]rror|[Ff]ailed)\s*\}')
REFUSAL = re.compile(r'permissionRefusal(?:AnyOf|AllOf)?\(')
FORM = re.compile(r'<form\b')
TABLE = re.compile(r'<table\b')
# A CREATE form, told apart from a FILTER form by its submit handler. This is the fifth false-positive class
# the formal pass documented — "a filter form was mistaken for a create form" — and correcting for it is what
# hid two REAL violations: a filter form above the table satisfied a first-form-vs-first-table comparison
# while the create form sat below the list. `/vendors` (onSearchSubmit above, onCreate below) and
# `/employees/[id]` (the training table above, onRecordTraining below) were both inside a pass that reported
# rule 1 as 0 violations.
CREATE_FORM = re.compile(
    r'<form[^>]*onSubmit=\{[^}]*\b(?:onCreate|onAdd|onRecord|onRegister|onLog|onRaise|onSave'
    r'|handleCreate|createPr)\w*'
)
FILTER_FORM = re.compile(
    r'<form[^>]*onSubmit=\{[^}]*\b(?:onSearch|onFilter|onBrowse|onQuery|onLookup|applyFilters'
    r'|runBrowse|runWorkflowHistory|runDocumentHistory|runSearch)\w*'
)
# Every form with a handler at all, so the two above can be measured against the TOTAL.
ANY_FORM = re.compile(r'<form[^>]*onSubmit=\{')
# WHAT THIS CANNOT CLASSIFY IS PART OF THE OUTPUT.
#
# Measured after the two rule-1 violations were found: 77 forms in the app carry an onSubmit handler and the
# first version of these patterns recognised 22. The two violations happened to use `onCreate` and
# `onRecordTraining` — which is LUCK, not coverage, and a check whose blind spot is two thirds of the
# population must not report "none found" as if it had looked at all of them.
#
# The residue is mostly a bare `submit` (14 screens) or an inline arrow calling it, which carries no
# information about the form's KIND at all. So the report prints an UNCLASSIFIED count and the rule-1 line
# says when a screen's forms are among them. A zero with 55 unclassified forms behind it is not a clean
# result; it is an unmeasured one.
# Local component imports, so a state rendered by a child is seen. One level only, deliberately: following
# the whole tree turns this into a bundler and the extra depth has not been needed.
IMPORT = re.compile(r"import\s*\{[^}]*\}\s*from\s*'((?:\.\.?/)[^']+)'")


def resolve(base_dir, spec):
    path = os.path.normpath(os.path.join(base_dir, spec))
    for candidate in (path + '.tsx', path + '.ts', os.path.join(path, 'index.tsx')):
        if os.path.isfile(candidate):
            return candidate
    return None


def read_with_children(page_path):
    """The page source, plus the source of each locally-imported component (one level)."""
    src = io.open(page_path, encoding='utf-8').read()
    base = os.path.dirname(page_path)
    extra = []
    for m in IMPORT.finditer(src):
        child = resolve(base, m.group(1))
        if child and child != page_path:
            try:
                extra.append(io.open(child, encoding='utf-8').read())
            except OSError:
                pass
    return src, '\n'.join(extra)


def probe(page_src, child_src):
    both = page_src + '\n' + child_src
    return {
        'loading': bool(LOADING.search(both)),
        'empty': bool(EMPTY.search(both)),
        'error': bool(ERROR.search(both)),
        'refusal': bool(REFUSAL.search(both)),
        # Rule 1 is about the PAGE's own layout, so offsets come from the page file alone.
        'forms': [page_src[:m.start()].count('\n') + 1 for m in FORM.finditer(page_src)],
        'tables': [page_src[:m.start()].count('\n') + 1 for m in TABLE.finditer(page_src)],
        'creates': [page_src[:m.start()].count('\n') + 1 for m in CREATE_FORM.finditer(page_src)],
        'filters': [page_src[:m.start()].count('\n') + 1 for m in FILTER_FORM.finditer(page_src)],
        'handlers': len(ANY_FORM.findall(page_src)),
    }


# ---------------------------------------------------------------------------- the ratchet
#
# THREE budgets, one per worklist, because the three states fail differently and a single total
# would let one be traded for another silently.
#
# Each is a WORKLIST and not a violation count — this script's own closing line says so, and batch 4
# flagged three screens that were all correct. So the budgets are at today's measured numbers and
# what they enforce is the owner's third part of decision 34: THE COUNT NEVER RISES. A NEW screen
# shipped without an empty state, a load-error branch or a permission refusal fails the build; the
# existing rows are read and closed deliberately, one at a time, lowering the budget as they go.
#
# The known-correct exceptions are why these do not start at 0 and why lowering them is a judgement
# rather than a sweep: a detail page addressed by an id answers 404 and not 403 ON PURPOSE (a 403
# there discloses that another office's record exists), `/settings/security` must stay ungated or ten
# of eleven roles can never enrol in MFA, and a screen that loads nothing has no empty state to be
# missing.
#
# Measured 2026-10-22 across 106 screens; all three matched the screen-pass measurement document.
NO_LOAD_ERROR_BUDGET = 1
NO_PERMISSION_REFUSAL_BUDGET = 9
NO_EMPTY_STATE_BUDGET = 2

# Blank is not zero. A screen root that moves takes all three counts to zero, and a report of three
# zeroes is indistinguishable from a finished job.
MINIMUM_SCREENS_SCANNED = 90


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    rows = []
    for root, _, files in os.walk(APP):
        if 'page.tsx' not in files:
            continue
        rel = os.path.relpath(root, APP).replace(os.sep, '/')
        if rel == '.':
            rel = '(home)'
        if args and not any(a == rel or rel.startswith(a) for a in args):
            continue
        page_src, child_src = read_with_children(os.path.join(root, 'page.tsx'))
        rows.append((rel, probe(page_src, child_src)))
    rows.sort()

    header = '%-42s %-4s %-5s %-5s %-7s %s'
    print(header % ('screen', 'load', 'empty', 'error', 'refusal',
                    'form@ / table@ (rule 1 — read the PAIRS, and mind helpers)'))
    for rel, p in rows:
        pairs = ''
        if p['forms'] or p['tables']:
            pairs = 'forms %s | tables %s' % (p['forms'] or '-', p['tables'] or '-')
            if p['forms'] and p['tables'] and min(p['forms']) > min(p['tables']):
                pairs += '   <-- first form below first table: READ IT'
            # THE MASKED CASE, and the one that matters most: a CREATE form below a table, where a FILTER
            # form above it made the comparison on the line above pass. Two screens were wrong this way
            # inside a pass that reported rule 1 as 0 violations.
            elif p['creates'] and p['tables'] and min(p['creates']) > min(p['tables']):
                pairs += '   <-- CREATE form below a table, filter form above it: READ IT'
            elif (p['tables'] and p['handlers']
                  and p['handlers'] > len(p['creates']) + len(p['filters'])
                  and max(p['forms']) > min(p['tables'])):
                # UNDECIDED, and narrowed by batch 8: a form's KIND only matters when a form sits BELOW a
                # table. If EVERY form on the screen is above EVERY table, rule 1 holds whether that form
                # creates or filters — so an unclassified handler there is not an open question.
                #
                # That distinction took the undecided count from 26 to a much smaller set, and the five
                # screens batch 8 read (communications, complaints, feedback, retention-cases,
                # service-requests) are all in the dropped group: one form each, above its table.
                pairs += '   (unclassified form BELOW a table — rule 1 UNDECIDED here)'
        print(header % (rel,
                        'y' if p['loading'] else '.',
                        'y' if p['empty'] else '.',
                        'y' if p['error'] else '.',
                        'y' if p['refusal'] else '.',
                        pairs))
    print('\nscreens %d' % len(rows))
    for label, key in (('no load-error branch', 'error'),
                       ('no permission refusal', 'refusal'),
                       ('no empty-state signal', 'empty')):
        missing = [rel for rel, p in rows if not p[key]]
        print('%-24s %3d   %s' % (label, len(missing), ' '.join(missing[:8])))
    handlers = sum(p['handlers'] for _, p in rows)
    classified = sum(len(p['creates']) + len(p['filters']) for _, p in rows)
    print('%-24s %3d   of %d forms carrying a handler — rule 1 is UNDECIDED for the rest'
          % ('forms classified', classified, handlers))
    print('\nEach count is a WORKLIST. Batch 4 flagged three screens and all three were correct — read before\n'
          'calling anything a violation.')

    if '--check' not in sys.argv:
        return 0

    if args:
        print('\nfour-states: REFUSED — --check measures the whole app and was given a screen '
              'filter (%s). A budget compared against a subset is not a budget.' % ', '.join(args))
        return 1

    if len(rows) < MINIMUM_SCREENS_SCANNED:
        print('\nfour-states: REFUSED — only %d screen(s) scanned against a floor of %d. The screen '
              'root has moved and all three counts above are meaningless. Blank is not zero.'
              % (len(rows), MINIMUM_SCREENS_SCANNED))
        return 1

    failed = False
    for label, key, budget, const, consequence in (
        ('no load-error branch', 'error', NO_LOAD_ERROR_BUDGET, 'NO_LOAD_ERROR_BUDGET',
         'A screen whose read fails and says nothing leaves a reader looking at an empty page with '
         'no way to tell a broken server from an office with no records.'),
        ('no permission refusal', 'refusal', NO_PERMISSION_REFUSAL_BUDGET,
         'NO_PERMISSION_REFUSAL_BUDGET',
         'A screen that refuses without saying so sends somebody to ask for the wrong grant. Use '
         '`permissionRefusal(t, actKey, code)` — never write the sentence.'),
        ('no empty-state signal', 'empty', NO_EMPTY_STATE_BUDGET, 'NO_EMPTY_STATE_BUDGET',
         'An empty table reads as "nothing to see" where the honest answer is "nothing here yet, '
         'and here is how the first one gets created".'),
    ):
        actual = len([1 for _rel, p in rows if not p[key]])
        if actual > budget:
            print('\nfour-states: FAILED — %s is %d against a budget of %d.' % (label, actual, budget))
            print(consequence)
            print('Do NOT raise %s: the owner struck attrition, so this number only falls.' % const)
            failed = True
        elif actual < budget:
            print('\nfour-states: FAILED — %s is only %d, so lower %s to %d.'
                  % (label, actual, const, actual))
            print('This half is what stops the ratchet becoming a ceiling.')
            failed = True

    if failed:
        return 1

    print('\nfour-states: all three classes are at their declared budgets — %d load-error, '
          '%d refusal, %d empty-state.'
          % (NO_LOAD_ERROR_BUDGET, NO_PERMISSION_REFUSAL_BUDGET, NO_EMPTY_STATE_BUDGET))
    return 0


sys.exit(main())
