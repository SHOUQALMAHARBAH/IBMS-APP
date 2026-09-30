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
    }


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
    print('\nEach count is a WORKLIST. Batch 4 flagged three screens and all three were correct — read before\n'
          'calling anything a violation.')
    return 0


sys.exit(main())
