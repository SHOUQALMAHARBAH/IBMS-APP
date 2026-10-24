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

## WHAT A ZERO FROM THIS SCRIPT MEANS, AND WHAT IT DOES NOT

**Zero means zero of what this detector can see.** SIX blind spots and one counting defect have been found,
and every single one was found by READING a screen for some other reason — none by the guard, and none by
reasoning about the patterns:

    1  a date inside a template literal            (compliance dashboard)
    2  prose on a line that also calls t()         (insurance-programs/new)
    3  prose after a backtick                      (risk-profiles)
    4  LOWERCASE prose, which no capital-initial rule can see
    5  a ONE-WORD label before a colon             (13 strings on 8 screens, while this read 0/102)
    6  a BARE JSX TEXT LINE, one word, no colon    (21 strings on 14 screens, while this read 0/102)
    +  a DEDUPE keyed on the text alone, so a screen with three `Cancel` buttons reported ONE

Numbers 5 and 6 are the ones to keep in mind, and 6 is the worse of the two: this script reported **0 across
102 screens** while `Cancel` ×7, `Save` ×4, `Rename` ×2, `Search` ×4, `Edit`, `Back`, `Total`, `Channel` and
`Category` stood typed into fourteen screens in English. Fourteen of the twenty-one had a translated key
sitting unused in `common.ts` — the Arabic existed and the screen did not reach for it.

The dedupe is the counting defect and it compounded number 6: `not any(text == t for _, t in out)` skipped a
repeat of the same text ANYWHERE in the file, so the first pass reported 19 where there were 21, and the last
two only became visible once the first two were fixed. It is keyed on `(line, text)` now.

**So this guard PREVENTS REGRESSION; it does not PROVE COMPLIANCE.** Nobody knows whether there is a seventh
blind spot, and the base rate so far is that there is. A reader who takes "0/102" as "there are none" is
building on something that was not measured — the honest reading is "none of the six known shapes remain".

If you find a seventh: add the pattern, add its real case to `--self-test` (never an invented one), and add a
line above. The list getting longer is the point. And when you tighten a pattern, MEASURE THE COUNT BOTH
WAYS — number 6's first version reported 277 hits on 97 screens, almost all of them multi-line code
continuations, which is the cry-wolf direction and gets a guard switched off rather than fixed.

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
# FAILURE MODE 5, found while reading two aria-labels rather than by running anything: a ONE-WORD LABEL
# followed by a colon. `<strong>Status: {t(…)}</strong>` survives every pattern above — the `t()` strip
# leaves `<strong>Status: </strong>`, and PROSE needs two words. Thirteen of these existed on eight
# screens while this script reported 0/102, including a THIRD miss on `/dashboards/financial`.
#
# Narrow deliberately: a capitalised word of 3+ letters immediately before a colon. `Status:`, `Current:`,
# `Withdrawn:` are labels; `http:` and `Record<` are not, and the exclusions below carry the rest.
ONE_WORD_LABEL = re.compile(r'(?:^|[>`]|\}\s)\s*([A-Z][a-z]{2,})\s*:')
# FAILURE MODE 6, found in batch 5 by READING a screen for something else: a BARE JSX TEXT LINE holding one
# English word and no colon. `/insurance-programs/new` rendered a back button whose label was the literal
# text `← Back`, and every pattern above missed it — PROSE needs two capitalised words, TEMPLATE_PROSE needs
# backticks, ONE_WORD_LABEL needs a colon. The seventh way this script can report a clean screen that is not.
#
# Narrow deliberately: a line that is PURE TEXT — no tag, no brace, no attribute, no quote — holding one or
# two words of which the first is 3+ letters. Any line carrying JSX or an expression is already covered by
# the patterns above and is excluded here, which is what keeps this from firing on ordinary markup.
BARE_TEXT_LINE = re.compile(r'^[^<>{}=\'"`]*?([A-Za-z]{3,}(?:\s+[A-Za-z]+)?)\s*$')
# FAILURE MODE 7 — A PARENTHETICAL. Found by the OWNER reading `/internal-controls` while this script
# reported 0 for it, and the diagnosis is a shape rather than an accident:
#
#   `(dormant)`                        a bare JSX text line WRAPPED IN PARENTHESES
#   `{p.truncated ? ' (truncated)' : ''}`   a QUOTED lowercase fragment in a JSX expression
#
# Why all five patterns above miss both, traced one at a time rather than guessed:
#   - PROSE needs `[A-Z][a-z]+` and two words. Both are one lowercase word.
#   - TEMPLATE_PROSE needs BACKTICKS and two words. One is single-quoted, both are one word.
#   - ONE_WORD_LABEL needs a colon. Neither has one.
#   - BARE_TEXT_LINE ends `\s*$`, so the CLOSING PAREN defeats it — the leading `(` is inside its
#     character class and fine, the trailing `)` is not whitespace. That one character is the whole miss.
#   - And `' (truncated)'` carries `{`, `}` and `'`, every one excluded by BARE_TEXT_LINE's class.
#
# Both words were LOAD-BEARING, which is why this is the eighth and worst miss: `(truncated)` is the only
# thing telling a reader the self-approval scan hit its limit and the result is INCOMPLETE, so an Arabic
# reader saw a row of zeroes under a partial scan and had no way to know it was not clean.
#
# NARROW DELIBERATELY, BOTH OF THEM, because the cry-wolf direction is the one this script's own header
# calls harder to recover from than under-counting. A parenthetical is matched only when the paired
# parentheses are the WHOLE of the thing:
#   - a text line that is NOTHING BUT a parenthetical. `(dormant)` matches; `doThing(arg)` does not,
#     because the line must START with `(`. Widening BARE_TEXT_LINE's own anchor to tolerate a trailing
#     `)` was tried first and REJECTED: it makes every bare call line a finding.
#   - a quoted string that is NOTHING BUT a parenthetical. `' (truncated)'` matches; `'/customers/(x)'`
#     does not, and no import, key, style value or data attribute in this tree has this shape.
PARENTHETICAL_TEXT_LINE = re.compile(r'^\(\s*([A-Za-z][A-Za-z ,.\'\-\u2014]{1,60}?)\s*\)$')
QUOTED_PARENTHETICAL = re.compile(
    r'[\'"`]\s*\(\s*([A-Za-z][A-Za-z ,.\'\-\u2014]{1,60}?)\s*\)\s*[\'"`]'
)

# Bare words that are code, not copy. A statement on its own line reaches this pattern too.
NOT_BARE_COPY = {
    'return', 'else', 'true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'async', 'await',
    'export', 'default', 'function', 'from', 'import', 'as', 'is', 'and', 'or', 'not', 'in', 'of',
    'if', 'for', 'while', 'case', 'break', 'continue', 'catch', 'try', 'finally', 'throw', 'new',
    'typeof', 'void', 'yield', 'satisfies', 'interface', 'type', 'enum', 'class', 'extends',
}

# Type names and switch syntax that a colon-based pattern would otherwise read as labels.
NOT_A_LABEL = {
    'Record', 'Object', 'Promise', 'String', 'Number', 'Boolean', 'Partial',
    'Array', 'Date', 'Math', 'JSON', 'Omit', 'Pick', 'Exclude', 'Readonly',
}


# ----------------------------------------------------------------------------------------------
# THE TEN PARENTHETICALS FAILURE MODE 7 FOUND, DECLARED — each owed an Arabic word by the owner.
#
# This is NOT a raised budget. The ban on hardcoded English is still flat at zero for everything
# else, and these ten are named individually with what each MEANS, because the meaning is what
# makes them worth her time rather than a translation chore. Every one is a status marker that
# changes how a figure or a row should be read:
#
#   - `(capped)` ×3 is the same class as the `(truncated)` that started this: THE NUMBER SHOWN IS
#     NOT THE REAL NUMBER. An Arabic reader reads the capped figure as the true one.
#   - `(overdue)` ×3 and `(containment overdue)` are PASSED STATUTORY DEADLINES — a PDPL data
#     subject request, a breach containment clock, a regulatory obligation, a BCP test.
#   - `(lapsed)` is professional-indemnity cover that has ENDED.
#   - `(drafted)` is this repository's own sourced-versus-drafted distinction on an SLA duration:
#     a drafted figure carries no regulatory source and must not be read as one.
#
# A ROW IS REMOVED WHEN ITS STRING IS TRANSLATED, NEVER EDITED TO MATCH A NEW ONE. The gate fails
# on a stale row for the same reason it fails on an undeclared finding: a declaration that no
# longer occurs is a declaration covering whatever lands next.
#
# Keyed on `screen|string` exactly, so this cannot become a hiding place for a DIFFERENT kind of
# finding on the same screen — a `PROSE` or `ONE_WORD_LABEL` hit still fails flat.
DECLARED_PARENTHETICALS = {
    'audit-trail|(requested)',
    'bcp-dr-plans|(overdue)',
    'claims-analytics|(capped)',
    'dashboards/claims|(capped)',
    'dsr|(overdue)',
    'incidents|(containment overdue)',
    'operational-pi-risk|(lapsed)',
    'regulatory-compliance|(overdue)',
    'sla-dashboard|(drafted)',
}

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
    lines = mask_comments(src).split('\n')
    for i, raw in enumerate(lines, 1):
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
            if len(text) > 4 and (i, text) not in out:
                out.append((i, text[:60]))
        if not re.search(r'(case |switch|\bextends\b|\bimplements\b)', s):
            for m in ONE_WORD_LABEL.finditer(stripped):
                text = m.group(1)
                if text not in NOT_A_LABEL and (i, text) not in out:
                    out.append((i, text + ':'))
        # FAILURE MODE 7 — a parenthetical, in either of its two forms. Neither needs the
        # previous-line context failure mode 6 requires, because the paired parentheses are
        # themselves the evidence that this is a remark to a reader rather than code.
        for m in QUOTED_PARENTHETICAL.finditer(stripped):
            text = m.group(1).strip()
            if (text.split()[0].lower() not in NOT_BARE_COPY
                    and not ALLOW.match(text)
                    and (i, text) not in out):
                out.append((i, '(%s)' % text[:58]))
        paren_line = PARENTHETICAL_TEXT_LINE.match(stripped.strip())
        if paren_line:
            text = paren_line.group(1).strip()
            if (text.split()[0].lower() not in NOT_BARE_COPY
                    and not ALLOW.match(text)
                    and (i, text) not in out
                    and (i, '(%s)' % text[:58]) not in out):
                out.append((i, '(%s)' % text[:58]))
        # Failure mode 6 — a bare JSX text line, and it needs the PREVIOUS LINE to prove it is one.
        #
        # Without that, this fired 277 times on 97 screens and almost every hit was a multi-line CODE
        # expression whose continuation happens to be bare words: `err instanceof ApiError`, `message`,
        # `outcomes`. That is the cry-wolf direction, which this script's own header calls as useless as
        # under-counting and harder to recover from.
        #
        # JSX text children come immediately after a tag CLOSES. So the previous non-blank line must end in
        # `>` — and not `=>`, because an arrow function ends that way too and `onClick={() =>` is followed
        # by exactly the sort of code continuation this has to exclude.
        prev = next((p.strip() for p in reversed(lines[:i - 1]) if p.strip()), '')
        if prev.endswith('>') and not prev.endswith('=>'):
            bare = BARE_TEXT_LINE.match(stripped.strip())
            if bare:
                text = bare.group(1).strip()
                if (text.split()[0].lower() not in NOT_BARE_COPY
                        and not ALLOW.match(text)
                        and (i, text) not in out):
                    out.append((i, text))
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
        (
            'failure mode 5 — a ONE-WORD label beside a translated value',
            "          <strong>Status: {t(ENUM_LABEL.X[y.status])}</strong>\n",
            True,
        ),
        (
            'a TypeScript type before a colon is not a label',
            '  const byId: Record<string, Thing> = {};\n',
            False,
        ),
        (
            'a switch case is not a label',
            "      case 'Active':\n",
            False,
        ),
        (
            # TWO lines, because the rule is contextual: a bare word is JSX text only when the line before
            # it closes a tag. A one-line case could never pass, and writing it that way would have been a
            # test asserting the wrong thing about a rule that is deliberately context-dependent.
            'failure mode 6 — a BARE JSX TEXT LINE after a tag close',
            '      >\n        ← Back\n',
            True,
        ),
        (
            'the same bare word after an ARROW function is code, not copy',
            '      onClick={() =>\n        doTheThing\n',
            False,
        ),
        (
            'a bare statement on its own line is not copy',
            '      ) {\n        return\n',
            False,
        ),
        (
            # FAILURE MODE 7, both forms. These two lines are the real misses, byte for byte as they
            # stood on /internal-controls while this script reported 0 for that screen.
            'failure mode 7a — a parenthetical BARE TEXT LINE',
            '      >\n        (dormant)\n',
            True,
        ),
        (
            'failure mode 7b — a QUOTED lowercase parenthetical in a JSX expression',
            "                        {p.truncated ? ' (truncated)' : ''}\n",
            True,
        ),
        (
            # The cry-wolf direction, which matters more than the catch: a bare CALL must not read as
            # a parenthetical. Widening BARE_TEXT_LINE to tolerate a trailing `)` would have made
            # every one of these a finding.
            'a bare function call is not a parenthetical',
            '      >\n        doTheThing(arg)\n',
            False,
        ),
        (
            'a route literal with parentheses is not a parenthetical',
            "  const p = '/customers/(x)';\n",
            False,
        ),
        (
            'a parenthetical that is ALREADY translated is clean',
            "                        {p.truncated ? ` ${t('icTruncatedNote')}` : ''}\n",
            False,
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
    seen = set()
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
            # Keyed on screen + STRING, never on the line number, so moving a marker up or
            # down a file is not a stale declaration.
            seen.add('%s|%s' % (rel, text))

    print('\nscreens scanned                     %4d' % len(screens))
    print('screens with hardcoded English      %4d' % dirty)
    print('strings                             %4d' % total)

    # THE DECLARATION, IN BOTH DIRECTIONS. `strings` stays the TOTAL and stays printed, so
    # the real figure is never hidden behind a declaration; what the gate reads is
    # `undeclared`.
    undeclared = sorted(seen - DECLARED_PARENTHETICALS)
    stale = sorted(DECLARED_PARENTHETICALS - seen)
    print('declared parentheticals (owner)     %4d' % len(DECLARED_PARENTHETICALS))
    print('undeclared                          %4d' % len(undeclared))
    for key in undeclared:
        print('      UNDECLARED  %s' % key)
    for key in stale:
        print('      STALE       %s' % key)
    if stale:
        print('\nhardcoded-ui-english: FAILED on a STALE declaration. The row(s) above no '
              'longer occur, so remove them from DECLARED_PARENTHETICALS in the same commit '
              'that translated the string. A declaration left behind covers whatever lands '
              'next, which is the whole reason this is a declared SET rather than a count.')
        return 1
    if undeclared:
        print('\nhardcoded-ui-english: FAILED. This platform is Arabic-first, so an '
              'untranslated string is read by nobody in the primary language. Add the key to '
              'a dictionary in lib/i18n/translations/ and render it through t(). DECLARING a '
              'row is NOT the ordinary fix: the nine declared rows are the owner\'s own '
              'backlog, each carrying a meaning she has to decide, and an eleventh needs the '
              'same.')
        return 1
    return 0


sys.exit(main())
