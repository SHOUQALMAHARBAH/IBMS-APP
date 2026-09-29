# -*- coding: utf-8 -*-
"""User-facing English written directly into a screen, on an Arabic-first platform.

Rule 6 of `docs/b7-consistency-record.md`: Arabic and English say the same thing. A string typed into
JSX says it in one language only, and the one that gets missed is the primary one.

## Why this is a script and not a grep

Three ad-hoc detectors written during item 5 each UNDER-COUNTED, which is the dangerous direction: a
sweep that misses violations reports a screen as clean.

  1. A pattern matching `>Text<` missed a date inside a TEMPLATE LITERAL — the compliance dashboard's
     `` ` (as of ${...})` ``, found only because a source-reading guard looked for the field instead.
  2. A refined pattern SKIPPED ANY LINE CONTAINING `t(`, so `Needs assessment {id} — status {t(...)}`
     was invisible: the line is half translated, and the untranslated half is the violation.
  3. The same pattern missed `` `Risk profile ${id}` `` because a BACKTICK is not one of the characters
     it accepted before a capital letter.

So the scan is here, with a self-test whose cases are those three real misses rather than invented ones.
`--self-test` is what makes a future refinement provable rather than hopeful.

Run:  python scripts/measurements/hardcoded-ui-english.py [<screen-glob> ...]
      python scripts/measurements/hardcoded-ui-english.py --self-test
"""
import io
import os
import re
import sys

APP = os.path.join('apps', 'web', 'app', '(app)')

# A translated call, so its ARGUMENT (a key) is never mistaken for prose. Removed rather than used to
# skip the line — failure mode 2 was skipping any line that contained one.
T_CALL = re.compile(r"\b(?:t|tr|tPlural)\(\s*'[^']*'(?:\s*,[^)]*)?\)")
# Attribute values and machine strings that are not user-facing copy.
MACHINE = re.compile(
    r'(data-testid|htmlFor|aria-[a-z]+|className|style=|key=|\bid=|router\.push|'
    r'api(?:Get|Post|Patch|Delete|FetchBlob)|encodeURIComponent|localStorage|'
    r'process\.env|console\.|new RegExp)'
)
CODE_PREFIX = ('//', '*', '/*', 'import ', 'export type', 'type ', 'interface ', 'const ', 'let ')
# Two or more words starting with a capital, after ANY boundary that can precede JSX text — including a
# BACKTICK, which failure mode 3 missed.
PROSE = re.compile(r'(?:^|[>`]|\}\s|\{\'|\{"|\{`)\s*([A-Z][a-z]+(?:\s+[A-Za-z()—-]+){1,})')
# Words that look like prose but are code or a proper noun the product does not translate.
ALLOW = re.compile(r'^(?:JOD|OK|PDF|CSV|Claude|Next|React|TypeScript|Prisma)\b')
# Failure mode 1 was LOWERCASE prose — ` (as of ${...})` — which no capital-initial rule can see. So
# template-literal strings get their own pattern: two or more space-separated lowercase words INSIDE
# backticks. Narrow on purpose. A route template (`/customers/${id}`) has no spaces and cannot match; a
# sentence does. Anything wider started reporting style strings, which is the cry-wolf direction.
TEMPLATE_PROSE = re.compile(r'`[^`]*?\b([a-z]{2,}(?:\s+[a-z]{2,}){1,})\b[^`]*?`')


def mask_comments(src):
    """
    Blank out every JSX and block comment, KEEPING the line count so reported numbers stay right.

    A line-state toggle is not enough, and that is measured rather than assumed: the DSR screen has a
    multi-line `{/* … */}` whose tail was reported as UI copy, because the toggle can be set and cleared
    by one line and then leaves the rest of the block exposed. Masking the whole source with a regex has
    no state to get wrong.
    """
    def blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))

    src = re.sub(r'\{\s*/\*.*?\*/\s*\}', blank, src, flags=re.S)
    src = re.sub(r'/\*.*?\*/', blank, src, flags=re.S)
    return src


def findings(src):
    """[(line_no, text)] for user-facing English in this source. Comments are masked first."""
    out = []
    for i, raw in enumerate(mask_comments(src).split('\n'), 1):
        s = raw.strip()
        if s.startswith(CODE_PREFIX):
            continue
        if MACHINE.search(s):
            continue
        # Strip translated calls, then look at what is LEFT. This is failure mode 2's fix: a line that
        # is half translated has its untranslated half examined rather than being skipped whole.
        stripped = T_CALL.sub('', raw)
        for m in PROSE.finditer(stripped):
            text = m.group(1).strip()
            if len(text) > 6 and not ALLOW.match(text):
                out.append((i, text[:60]))
        for m in TEMPLATE_PROSE.finditer(stripped):
            text = m.group(1).strip()
            if len(text) > 4 and not any(text == t for _, t in out):
                out.append((i, text[:60]))
    return out


def self_test():
    """The three real misses, as cases. Each must be FOUND; each clean line must not be."""
    cases = [
        (
            'failure mode 1 — a date inside a template literal',
            "                    ? ` (as of ${summary.scan.asOf.slice(0, 10)})`\n",
            True,
        ),
        (
            'failure mode 2 — prose on a line that ALSO calls t()',
            "        Needs assessment {assessment.id.slice(0, 8)} — status {t(ENUM_LABEL.X[y])}.\n",
            True,
        ),
        (
            'failure mode 3 — prose after a BACKTICK',
            "                {profile.siteLabel ?? `Risk profile ${profile.id.slice(0, 8)}`}\n",
            True,
        ),
        (
            'a fully translated line is clean',
            "          <h1>{t('iprogHeading')}</h1>\n",
            False,
        ),
        (
            'a test id is not user-facing copy',
            '          <div data-testid="Some Thing Here">{v}</div>\n',
            False,
        ),
        (
            'a JSX comment is not user-facing copy',
            '      {/* Status: this explains something in English on purpose */}\n',
            False,
        ),
        (
            'an untranslated currency label IS a finding',
            '        <span>Current asset value (JOD): {rec.currentAssetValue}</span>\n',
            True,
        ),
    ]
    failures = 0
    for name, src, expected in cases:
        found = len(findings(src)) > 0
        ok = found == expected
        print('  %s%s' % ('ok   ' if ok else '*** FAIL *** ', name))
        if not ok:
            failures += 1
            print('      expected %s, got %s  %r' % (expected, found, findings(src)))
    if failures:
        print('\nSELF-TEST FAILED — %d case(s). The detector would under-count.' % failures)
        return 1
    print('\nSELF-TEST PASSED — all three real misses are caught.')
    return 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--self-test' in sys.argv:
        return self_test()

    screens = []
    for root, _, files in os.walk(APP):
        if 'page.tsx' in files:
            rel = os.path.relpath(root, APP).replace(os.sep, '/')
            if not args or any(a in rel for a in args):
                screens.append(rel)
    screens.sort()

    total = 0
    dirty = 0
    for rel in screens:
        src = io.open(os.path.join(APP, rel, 'page.tsx'), encoding='utf-8').read()
        hits = findings(src)
        if not hits:
            continue
        dirty += 1
        total += len(hits)
        print('%-40s %d' % (rel, len(hits)))
        for line, text in hits:
            print('      L%-5s %r' % (line, text))

    print('\nscreens scanned                     %4d' % len(screens))
    print('screens with hardcoded English      %4d' % dirty)
    print('strings                             %4d' % total)
    return 0


sys.exit(main())
