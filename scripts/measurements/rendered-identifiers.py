# -*- coding: utf-8 -*-
"""Identifiers rendered to a person — rule 2 of `docs/b7-consistency-record.md`.

"No field asks for an identifier — not in the question and not in the answer. A screen that accepts a name
and then prints a uuid in its results has half complied."

## Why this is a separate script, and why it exists at all

Rule 2 was swept BY HAND in item 5 batch 2 and had no guard. `hardcoded-ui-english.py` could not stand in
for one, and the reason is the finding that produced this file:

  **that script STRIPS `t(...)` calls before looking at a line**, because a key is not prose. So an
  identifier passed as a translation PARAMETER is invisible to it — which is exactly where an identifier
  most naturally ends up, because it is being put INTO a sentence.

Found on `/claims/[id]`, whose page heading read `t('claimsDetailHeading', { name: … ?? claim.id.slice(0, 8) })`.
Rule 6's guard reported that screen clean, correctly, and rule 2 had nothing looking at it.

So this script inspects the ARGUMENTS rather than discarding them, and it is the one place rule 2 is
checked. `--self-test` uses that real case.

## What counts

A uuid reaching a reader. In practice that is `.id` — whole or sliced — appearing anywhere a person can
see it: JSX text, a translation parameter, an `aria-label`, a template literal.

## What deliberately does not count

  * `key={x.id}` — React's reconciliation key, never rendered.
  * `href`/`router.push` — an id in a URL is how the web addresses a record, not a label.
  * a prop passed to a child component (`customerId={c.id}`) — the child decides whether to render it,
    and a prop that happens to be named for an id is not a display.
  * `data-testid` — machinery for tests.

Those four exclusions are why this is narrow rather than noisy: without them the first run produced
twenty-six hits of which two were real, and a guard that cries wolf is one people switch off.

## A CLASS, NOT THREE INCIDENTS: the fallback whose condition cannot happen

Three of the sites this found were `<readable name> ?? <uuid>` where the null branch is STRUCTURALLY
IMPOSSIBLE:

    RiskProfile.siteLabel      optional in the DTO, and 767 rows across two databases had one. The
                              column was nullable by OMISSION; it is now NOT NULL and the branch is gone.
    AuditLogEntry.actorName    `userId` is NOT NULL with ON DELETE RESTRICT, so the actor always resolves
                              — CLAUDE.md records it and a test asserts the refusal.
    CombinedDutyAct.actorName  the same shape on `/internal-controls`.

**A branch guarding a state the database forbids is not defensive.** It is a dormant identifier: it never
renders, so nobody reads it, so nobody notices it prints a uuid — and it wakes up silently if the
constraint ever moves. Dead code is exactly where nobody looks.

So when this script reports a `?? id` fallback, the first question is not "what should it show instead"
but **"can that branch be reached at all"** — and the answer comes from the schema and the writers, not
from the screen. If it cannot be reached, delete it; the value that made it unreachable is the answer.
If it can, the fallback needs something a person recognises, and a uuid is not that.

Run:  python scripts/measurements/rendered-identifiers.py [<screen> ...]
      python scripts/measurements/rendered-identifiers.py --self-test
"""
import io
import os
import re
import sys

APP = os.path.join('apps', 'web', 'app', '(app)')

# An id reaching a reader: `.id` or `.id.slice(...)`, or a field whose name ends in `Id`.
ID_EXPR = re.compile(r'\b\w+\.(?:id|\w+Id)\b(?:\.slice\([^)]*\))?')
# REAL-WORLD identifiers, which are not system ids and are shown ON PURPOSE. `nationalId` ends in "Id" and
# is the entire subject of `/employees/reveal` — a guard that flags that screen for displaying a national
# ID is the cry-wolf case in its purest form, so the exclusion is named rather than inferred.
DOMAIN_IDENTIFIER = re.compile(r'\.(?:nationalId|passportId|taxId|commercialRegistrationId)\b')
# Indexing a record BY an id (`revealed[r.id]`) reads the stored value out; the id is the key, not the
# thing shown.
INDEXED_BY_ID = re.compile(r'\w+\[\s*$')
# The four exclusions, checked against the SURROUNDING context rather than the expression.
NOT_A_DISPLAY = re.compile(
    r'(key=\{|data-testid|href=|router\.push|\bpush\(|encodeURIComponent|'
    r'params\.set|apiGet|apiPost|apiPatch|apiDelete|apiFetchBlob|'
    r'^\s*\w+Id=\{|\s\w+Id=\{|useState|useCallback|useEffect|const |let |return \{|'
    # FORM WIRING. `htmlFor` / `id` build a label-to-input association and are never shown. Without these
    # the first run reported 84 hits of which two were real — the cry-wolf direction, as useless as
    # under-counting and harder to recover from, because people switch the guard off rather than fix it.
    r'htmlFor=|\bid=\{|'
    # A COMPARISON or a NULL CHECK is not a display: the id decides something, it is not the something.
    r'===|!==|'
    # A ROUTE or a query string, including when the `push(` sits on an earlier line.
    r'`/|\?\w+=\$\{|'
    # EVENT HANDLERS and state setters. An id handed to `setVal(c.id, …)` or used as a record key in
    # `{ ...n, [r.id]: v }` is addressing something, not being shown to anybody.
    r'\bon[A-Z]\w+=|\bset[A-Z]\w+\(|\[\w+\.id\]:)'
)
CODE_PREFIX = ('//', '*', '/*', 'import ', 'type ', 'interface ')


def mask_comments(src):
    """Blank comments, keeping line numbers. Same reasoning as the rule-6 scan: a line toggle leaks."""
    def blank(m):
        return re.sub(r'[^\n]', ' ', m.group(0))

    src = re.sub(r'\{\s*/\*.*?\*/\s*\}', blank, src, flags=re.S)
    return re.sub(r'/\*.*?\*/', blank, src, flags=re.S)


def findings(src):
    """[(line_no, text)] where an identifier can reach a reader."""
    out = []
    for i, raw in enumerate(mask_comments(src).split('\n'), 1):
        s = raw.strip()
        if not s or s.startswith(CODE_PREFIX):
            continue
        if NOT_A_DISPLAY.search(raw):
            continue
        for m in ID_EXPR.finditer(raw):
            after = raw[m.end():]
            before = raw[: m.start()]
            if DOMAIN_IDENTIFIER.search(m.group(0)) or INDEXED_BY_ID.search(before):
                continue
            # TESTED, NOT SHOWN. The decisive question is what follows the expression: an id that gates a
            # branch is not a display, however close it sits to one. `{u.employeeId ? (`,
            # `{x.approvedByUserId ? t('yes') : t('no')}` and `ids.has(i.id)` all read as hits to a
            # position-only rule, and all three are the id DECIDING something rather than being shown.
            if re.match(r'\s*(?:\?[^.]|&&|\|\||\)|\s*:\s*$)', after):
                continue
            if re.search(r'\.(?:has|includes|indexOf|get|find)\($', before):
                continue
            # A DISPLAY is: inside JSX text `{…}`, inside a template literal, inside an aria-label, or
            # passed as a value in a translation parameter object. The `t(` case is the whole point of
            # this file — the rule-6 scan throws that argument away.
            displayed = (
                'aria-label' in raw
                or '`' in before
                or re.search(r'\bt\(|\btr\(|\btPlural\(', before) is not None
                or re.search(r'^\s*\{', raw) is not None
                # ANY `>` earlier on the line, not one IMMEDIATELY before the brace. Once past a closing
                # angle bracket you are in children, and anything there is rendered.
                #
                # THE SIXTH BLIND SPOT, and the only one introduced by a REFORMAT rather than by code:
                # `<span style={{ opacity: 0.7 }}>· {r.entityId}</span>` stopped being reported when
                # prettier wrapped the line, because the `· ` between the `>` and the `{` defeated a
                # `>\s*\{` rule. The violation never changed — only its formatting did, and the count
                # silently fell by one. A detector whose answer depends on line wrapping is measuring the
                # formatter.
                # `[^=]>` and not a bare `>`: the `>` of an ARROW FUNCTION is not a JSX tag close, and
                # widening to any `>` pulled in every `onChange={(e) => setVal(c.id, …)}` handler — 27
                # findings became 54, almost all of them handlers passing an id to a setter. An id given to
                # a handler is not displayed.
                or re.search(r'[^=]>', before) is not None
            )
            if displayed:
                out.append((i, s[:88]))
                break
    return out


def self_test():
    cases = [
        (
            'THE REAL MISS — an id inside a translation parameter',
            "            {t('claimsDetailHeading', { name: claim.id.slice(0, 8) })}\n",
            True,
        ),
        (
            'an id inside a template literal',
            "                {p.siteLabel ?? `Risk profile ${p.id.slice(0, 8)}`}\n",
            True,
        ),
        (
            'an id in an aria-label',
            "              aria-label={t('rpOpenSurveyAria', { name: profile.id })}\n",
            True,
        ),
        ("a React key is not a display", '              key={profile.id}\n', False),
        (
            'an id in a route is not a display',
            "                onClick={() => router.push(`/policies/${policy.id}`)}\n",
            False,
        ),
        (
            'an id passed to a child is not a display',
            '            customerId={customer.id}\n',
            False,
        ),
        ('a data-testid is not a display', '  <li data-testid={`row-${r.id}`}>\n', False),
        (
            'a NATIONAL ID is a real-world identifier, shown on purpose',
            "        <p>{t('empdNationalIdLabel')} {employee.nationalId}</p>\n",
            False,
        ),
        (
            'indexing a record BY an id reads the value out, not the id',
            "              {t('empRevealNationalIdLabel')} {revealed[r.id]}\n",
            False,
        ),
        (
            'THE SIXTH — JSX text separated from its > by other characters',
            '          <span style={{ opacity: 0.7 }}>- {r.entityId}</span>\n',
            True,
        ),
        (
            'an arrow function is not a JSX tag close',
            '            onChange={(e) => setVal(c.id, e.target.value)}\n',
            False,
        ),
    ]
    failures = 0
    for name, src, expected in cases:
        got = len(findings(src)) > 0
        ok = got == expected
        print('  %s%s' % ('ok   ' if ok else '*** FAIL *** ', name))
        if not ok:
            failures += 1
            print('      expected %s, got %s' % (expected, got))
    if failures:
        print('\nSELF-TEST FAILED — %d case(s).' % failures)
        return 1
    print('\nSELF-TEST PASSED — the translation-parameter case is caught.')
    return 0


def main():
    if '--self-test' in sys.argv:
        return self_test()
    args = [a for a in sys.argv[1:] if not a.startswith('--')]

    screens = []
    for root, _, files in os.walk(APP):
        if 'page.tsx' in files:
            rel = os.path.relpath(root, APP).replace(os.sep, '/')
            if not args or any(a in rel for a in args):
                screens.append(rel)
    screens.sort()

    total = 0
    for rel in screens:
        hits = findings(
            io.open(os.path.join(APP, rel, 'page.tsx'), encoding='utf-8').read()
        )
        if not hits:
            continue
        total += len(hits)
        print('%-40s %d' % (rel, len(hits)))
        for line, text in hits:
            print('      L%-5s %s' % (line, text))

    print('\nscreens scanned                     %4d' % len(screens))
    print('identifiers reaching a reader       %4d' % total)
    return 0


sys.exit(main())
