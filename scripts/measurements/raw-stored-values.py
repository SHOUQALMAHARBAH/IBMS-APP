# -*- coding: utf-8 -*-
"""
A STORED VALUE RENDERED AS ITS OWN MEMBER NAME.

The owner's walk, module 0-c, group 5. Six of her fourteen sightings are this and
not hardcoded English at all — there is no English STRING in the source to find,
so `hardcoded-ui-english.py` cannot see any of them however many patterns it
grows. Her own words, screen by screen:

  /sla-policies            «ALL / ACTIVE / DRAFT / INACTIVE، و كل الدروب ليست
                            الي فيها بالانجليزي»
  /screening-matches        pending / confirmed / cleared
  /settings/insurance-lines «الفئة بالانجليزي خياراتها»
  /retention-disposal       «الجدول الي بهاي الصفحة كله انجليزي»
  /consent, /ropa-entries   the purpose column

## WHY THIS IS A SEPARATE SCRIPT AND NOT A NINTH PATTERN

Two different defects with two different fixes. A hardcoded string needs an i18n
KEY; a raw stored value needs an `ENUM_LABEL` ENTRY and a `t()` around it. Mixing
them would put rows with different remedies behind one number, and the keying of
`DECLARED_PARENTHETICALS` is on a STRING that does not exist here.

## THE FINDING THAT MATTERS MOST, AND IT CAME FROM A CHECK THAT ALMOST WAS NOT RUN

**Five of the twelve enums rendered raw ALREADY HAVE ARABIC LABELS** in
`enum-labels.ts` — `InsuranceLineCategory`, `ConsentPurpose`, `DocumentCategory`,
`DatasetVersionStatus` and `SlaPolicyStatus`. So her `/sla-policies` and
`/settings/insurance-lines` sightings need NO new Arabic whatever: the words ship
and the screens do not use them.

That check is in this file because skipping it is a recorded mistake of this
repository's own: batch eight measured eighteen owed words against one map,
concluded eighteen had to be written, and every one was already in the product.
Putting a word on the owner's list that already exists is the worst available
outcome, so this script prints which enums have a label and which do not.

## TWO SHAPES

SHAPE A — a PROPERTY ACCESS rendered raw: `{row.status}` where `status` carries an
enum. The field names are DERIVED from `schema.prisma` rather than listed, so a
new enum column is covered the day it ships.

SHAPE B — a DECLARED VOCABULARY rendered raw: `const STATUSES = ['ALL', …]` and
then `{STATUSES.map((s) => <button>{s}</button>)}`. Invisible to shape A, because
`{s}` is a bare identifier with no property access to key on, and invisible to
every string pattern, because the only literals are in the declaration.

## WHAT WAS NARROWED, AND WHY — MEASURED BOTH WAYS EACH TIME

  * A PROPERTY ACCESS is required. Matching a bare `{status}` collided with
    ordinary `ReactNode` props called `action`, `outcome` and `type`, including
    two in this repo's own shared components: 4 of 21 findings. That is the
    cry-wolf rate that gets a gate switched off rather than fixed. The cost is
    stated rather than hidden — a destructured enum rendered bare is invisible
    here, and shape B exists partly to cover the common form of that.
  * `${x.status}` inside a template literal depends on POSITION. In an attribute
    it is machine: `<tr key={`${r.source}-…`}>` was reported on a line whose
    render is `{t(ENUM_LABEL.WatchlistSource[r.source])}` — a correctly
    translated cell flagged as raw. In TEXT it is copy, and excluding both lost a
    real finding: `` `${x.legalHold.scope} — ${x.legalHold.reason}` `` renders a
    raw enum at a reader. Narrowed once and re-measured, not narrowed and
    trusted.

## A REPORT, NOT A GATE

Deliberately. Every row needs either an `ENUM_LABEL` entry that already exists
(five of the twelve) or a word the owner has to decide (seven), and a gate whose
only honest resolution is a declaration list is a gate that becomes a list. Read
the rows; the figure on its own says nothing.

Run:  python scripts/measurements/raw-stored-values.py
"""
import io
import os
import re
import sys

SCHEMA = os.path.join('packages', 'db', 'prisma', 'schema.prisma')
LABELS = os.path.join('apps', 'web', 'lib', 'i18n', 'enum-labels.ts')
ROOTS = [os.path.join('apps', 'web', 'app'), os.path.join('apps', 'web', 'components')]

# A JSX expression. The field names come from the schema, so this is not a word list.
EXPR = re.compile(r'\{\s*([A-Za-z_$][\w$.?\[\]\'"]*)\s*\}')
ATTR = re.compile(r'[A-Za-z-]+=\s*$')
ATTR_TEMPLATE = re.compile(r'[A-Za-z-]+=\{`[^`]*$')
TRANSLATED = re.compile(r'\bt\(|ENUM_LABEL|_LABEL\b|LABEL\[|formatD|format\(')
VOCAB = re.compile(r"(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]", re.S)


def enum_fields():
    """field name -> (enum types it carries, EVERY type it carries).

    BOTH, because a field NAME is not a type. `scope` is `PermissionScope` on
    `Permission` and a free-text `String` on `LegalHold` — "description / entity
    reference under hold" — and `purpose` is `ConsentPurpose` on `ConsentRecord`
    and a `String` on `RopaEntry`. Rendering free text raw is CORRECT: it is the
    office's own words. Keyed on the enum half alone, four of eleven findings were
    false positives, and the figure had already been reported.
    """
    src = io.open(SCHEMA, encoding='utf-8').read()
    enums = set(re.findall(r'^enum\s+(\w+)\s*\{', src, re.M))
    as_enum, as_any = {}, {}
    for block in re.findall(r'^model\s+\w+\s*\{(.*?)^\}', src, re.M | re.S):
        for line in block.splitlines():
            # `(?:\s|$)` and not `\s`: a field whose type ends the line has no trailing
            # space, and requiring one read 13 field names where there are 44.
            m = re.match(r'\s{2}(\w+)\s+(\w+)(\[\])?\??(?:\s|$)', line)
            if not m:
                continue
            name, typ = m.group(1), m.group(2)
            as_any.setdefault(name, set()).add(typ)
            if typ in enums:
                as_enum.setdefault(name, set()).add(typ)
    return enums, as_enum, as_any


def labelled():
    src = io.open(LABELS, encoding='utf-8').read()
    return set(re.findall(r'^  (\w+): \{', src, re.M))


def tsx_files():
    for root in ROOTS:
        for dirpath, _dirs, names in os.walk(root):
            for n in sorted(names):
                if n.endswith('.tsx'):
                    yield os.path.join(dirpath, n)


# ---------------------------------------------------------------------------
# DECLARED — owner decision 59. Every shape-A site that is still rendered raw,
# with the verdict a PERSON reached by reading the model rather than the row.
#
# WHY A DECLARATION AND NOT A FIX. This script reads TEXT, not types, so it cannot
# tell `ConsentRecord.purpose` (a Prisma ENUM, and a defect rendered raw) from
# `RopaEntry.purpose` (a free String a human typed, and CORRECT rendered raw). It
# said AMBIGUOUS BY TYPE for all four field names and its *label already ships*
# section printed empty while THREE such sites existed. The judgement is a reading;
# what a script can hold is the ANSWER to that reading, and whether a new site has
# appeared that nobody has read yet.
#
# A STALE ROW FAILS TOO — a site that stops being rendered raw must be removed from
# here, which is what stops this becoming a ceiling. Same design as the declared
# parentheticals in `hardcoded-ui-english.py`.
DECLARED_RAW = {
    # (file, line-expression) -> why rendering the stored value is CORRECT here
    ('apps/web/app/(app)/dpo-workspace/page.tsx', 'h.scope'):
        'FREE TEXT. `LegalHold.scope` is `String // description / entity reference '
        'under hold` — a sentence a person typed about what is held. Rendering a '
        "human's own words raw is the correct behaviour; a label map here would have "
        'nothing to map.',
    ('apps/web/app/(app)/retention-disposal/page.tsx', 'x.legalHold.scope'):
        'FREE TEXT — the same `LegalHold.scope`, reached through the extension row.',
    ('apps/web/app/(app)/retention-disposal/page.tsx', 'h.scope'):
        'FREE TEXT — the same `LegalHold.scope`, on the holds table.',
    ('apps/web/app/(app)/ropa-entries/page.tsx', 'r.purpose'):
        'FREE TEXT. `purpose String` on the RoPA entry — the processing purpose an '
        'officer wrote. NOT `ConsentRecord.purpose`, which is a Prisma ENUM and WAS '
        'a defect: same field name, two models, opposite answers.',
    ('apps/web/app/(app)/transaction-monitoring/page.tsx', 'r.patternType'):
        "DECISION 49's DECLARED FALLBACK, and it is rendered raw ON PURPOSE. The five "
        'declared patterns take their labels from '
        '`ENUM_LABEL.TransactionMonitoringPattern`; `patternType` is a free `String` '
        'in the database with its vocabulary only in the schema doc comment, so a '
        'SIXTH value is representable and renders AS STORED in monospace under its '
        'own tooltip — visibly machine text, never dressed up as a name.',
}


def main():
    enums, fields, all_types = enum_fields()
    if len(fields) < 30:
        sys.stderr.write(
            'REFUSING: parsed only %d enum-bearing field names from the schema. '
            'A run that finds nothing because it parsed nothing reads exactly like a '
            'clean tree.\n' % len(fields))
        return 2
    have_label = labelled()
    if len(have_label) < 20:
        sys.stderr.write('REFUSING: parsed only %d ENUM_LABEL entries.\n' % len(have_label))
        return 2

    shape_a, shape_b = {}, {}
    scanned = 0
    for path in tsx_files():
        scanned += 1
        src = io.open(path, encoding='utf-8').read()
        rel = path.replace(os.sep, '/')

        for i, line in enumerate(src.splitlines(), 1):
            if TRANSLATED.search(line):
                continue
            for m in EXPR.finditer(line):
                before = line[:m.start()]
                if before.endswith('$') and ATTR_TEMPLATE.search(before):
                    continue
                if ATTR.search(before):
                    continue
                expr = m.group(1)
                if '.' not in expr:
                    continue
                tail = expr.split('.')[-1].split('[')[0]
                if tail not in fields:
                    continue
                # A NAME USED FOR BOTH AN ENUM AND A STRING cannot be resolved from
                # text. Reported as such rather than as an enum render, because
                # rendering free text raw is correct and calling it a defect is the
                # cry-wolf direction.
                plain = sorted(all_types[tail] - enums)
                shape_a.setdefault(rel, []).append(
                    (i, expr, sorted(fields[tail]), plain))

        vocabs = {}
        for m in VOCAB.finditer(src):
            body = m.group(2)
            members = re.findall(r"['\"]([A-Za-z][\w .\-/]*)['\"]", body)
            if len(members) >= 2 and not re.search(
                    r'[\w)]\s*,', re.sub(r"['\"][^'\"]*['\"]", '', body)):
                vocabs[m.group(1)] = members
        for name, members in vocabs.items():
            for mo in re.finditer(re.escape(name) + r"\.map\(\s*\(?\s*(\w+)", src):
                var = mo.group(1)
                window = src[mo.end():mo.end() + 700]
                for tm in re.finditer(r'\{\s*' + re.escape(var) + r'\s*\}', window):
                    if re.search(r'[A-Za-z-]+=\s*$', window[:tm.start()]):
                        continue
                    line_no = src[:mo.end() + tm.start()].count('\n') + 1
                    shape_b.setdefault(rel, []).append((line_no, name, members))

    if scanned < 140:
        sys.stderr.write('REFUSING: scanned only %d tsx files.\n' % scanned)
        return 2

    print('schema enums %d   enum-bearing field names %d   ENUM_LABEL entries %d'
          % (len(enums), len(fields), len(have_label)))
    print('tsx files scanned %d' % scanned)
    print()

    print('=== SHAPE A — a property access rendered raw ===')
    a_total = 0
    needs_word = set()
    ambiguous = set()
    for rel in sorted(shape_a):
        print('  %s' % rel)
        for line, expr, es, plain in shape_a[rel]:
            # A FIELD NAME IS NOT AN ENUM. `status` carries 23 different enums across
            # the schema and this script reads TEXT, not types, so which one a given
            # render resolves to is beyond it. Listing all 23 would overstate the
            # question and make the row unreadable; the limit is stated instead, and
            # the row still names the line to go and look at.
            if plain:
                mark = ('AMBIGUOUS BY TYPE — `%s` is also a plain %s on another model, '
                        'where rendering it raw is CORRECT' % (
                            expr.split('.')[-1], '/'.join(plain)))
                ambiguous.add(expr.split('.')[-1])
            elif len(es) > 3:
                mark = ('AMBIGUOUS — `%s` carries %d different enums; which one depends '
                        'on the model, which this script cannot see' % (
                            expr.split('.')[-1], len(es)))
                ambiguous.add(expr.split('.')[-1])
            else:
                marks = []
                for e in es:
                    if e in have_label:
                        marks.append('%s HAS A LABEL' % e)
                    else:
                        marks.append('%s needs one' % e)
                        needs_word.add(e)
                mark = '; '.join(marks)
            print('      L%-5s {%s}   %s' % (line, expr, mark))
            a_total += 1
    print()
    print('=== SHAPE B — a declared vocabulary rendered raw ===')
    b_total = 0
    for rel in sorted(shape_b):
        print('  %s' % rel)
        for line, name, members in shape_b[rel]:
            print('      L%-5s %s -> %s' % (line, name, members[:6]))
            b_total += 1
    print()
    print('shape A %d render(s) across %d file(s)' % (a_total, len(shape_a)))
    print('shape B %d render(s) across %d file(s)' % (b_total, len(shape_b)))
    print()
    print('ENUMS RENDERED RAW THAT ALREADY HAVE AN ARABIC LABEL — no new words needed,')
    print('the screen simply does not use them:')
    already = sorted({e for rows in shape_a.values() for _l, _x, es, plain in rows
                      if not plain and len(es) <= 3 for e in es if e in have_label})
    for e in already:
        print('    %s' % e)
    print()
    print('ENUMS WITH NO LABEL — each is a word the owner has to decide:')
    for e in sorted(needs_word):
        print('    %s' % e)
    print()
    if ambiguous:
        print()
        print('FIELD NAMES THIS SCRIPT CANNOT RESOLVE — read the line, not the count:')
        for f in sorted(ambiguous):
            print('    %s' % f)
        print()
    print('raw-stored-values: the shape-A rows are a GATE now — see DECLARED_RAW at the')
    print('top. Everything else here is a REPORT: read the rows.')
    print()

    # ----------------------------------------------------------------- the gate
    #
    # Owner decision 59. Every shape-A site is either FIXED or DECLARED, so the
    # ambiguous bucket is zero by declaration. A new one fails rather than joining a
    # list nobody reads, and a STALE row fails too.
    seen = set()
    for rel in sorted(shape_a):
        for line, expr, _es, _plain in shape_a[rel]:
            seen.add((rel.replace('\\', '/'), expr))

    declared = {(f.replace('\\', '/'), e) for f, e in DECLARED_RAW}
    undeclared = sorted(seen - declared)
    stale = sorted(declared - seen)

    # A NON-VACUITY FLOOR. Both comparisons above are satisfied by a scan that found
    # nothing — the clean-nothing shape this repository has paid for repeatedly — and
    # five is the measured figure after decision 59.
    if not seen:
        print('FAIL  the shape-A scan found NOTHING, which reads exactly like a clean')
        print('      result. The matcher broke; it is not that every site was fixed.')
        return 1

    if undeclared:
        print('FAIL  %d shape-A site(s) are rendered raw and NOT declared:'
              % len(undeclared))
        for f, e in undeclared:
            print('        %s   {%s}' % (f, e))
        print()
        print('      READ THE MODEL, not the row: this script cannot tell a Prisma ENUM')
        print('      rendered raw (a defect) from a free String a human typed (correct).')
        print('      Then either fix it, or add it to DECLARED_RAW with the reason.')
        return 1

    if stale:
        print('FAIL  %d declared row(s) are no longer rendered raw — remove them:'
              % len(stale))
        for f, e in stale:
            print('        %s   {%s}' % (f, e))
        print()
        print('      A row that outlives its reason covers whatever lands next, which is')
        print('      how a declared list becomes a ceiling.')
        return 1

    print('DECLARED: all %d shape-A site(s) are accounted for, each with its reason.'
          % len(seen))
    for f, e in sorted(seen):
        print('    %s   {%s}' % (f, e))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
