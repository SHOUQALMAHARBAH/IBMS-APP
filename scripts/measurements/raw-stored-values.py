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
    """field name -> the enum(s) it carries, derived from the schema."""
    src = io.open(SCHEMA, encoding='utf-8').read()
    enums = set(re.findall(r'^enum\s+(\w+)\s*\{', src, re.M))
    out = {}
    for block in re.findall(r'^model\s+\w+\s*\{(.*?)^\}', src, re.M | re.S):
        for line in block.splitlines():
            # `(?:\s|$)` and not `\s`: a field whose type ends the line has no trailing
            # space, and requiring one read 13 field names where there are 44.
            m = re.match(r'\s{2}(\w+)\s+(\w+)(\[\])?\??(?:\s|$)', line)
            if m and m.group(2) in enums:
                out.setdefault(m.group(1), set()).add(m.group(2))
    return enums, out


def labelled():
    src = io.open(LABELS, encoding='utf-8').read()
    return set(re.findall(r'^  (\w+): \{', src, re.M))


def tsx_files():
    for root in ROOTS:
        for dirpath, _dirs, names in os.walk(root):
            for n in sorted(names):
                if n.endswith('.tsx'):
                    yield os.path.join(dirpath, n)


def main():
    enums, fields = enum_fields()
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
                if tail in fields:
                    shape_a.setdefault(rel, []).append((i, expr, sorted(fields[tail])))

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
        for line, expr, es in shape_a[rel]:
            # A FIELD NAME IS NOT AN ENUM. `status` carries 23 different enums across
            # the schema and this script reads TEXT, not types, so which one a given
            # render resolves to is beyond it. Listing all 23 would overstate the
            # question and make the row unreadable; the limit is stated instead, and
            # the row still names the line to go and look at.
            if len(es) > 3:
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
    already = sorted({e for rows in shape_a.values() for _l, _x, es in rows
                      if len(es) <= 3 for e in es if e in have_label})
    for e in already:
        print('    %s' % e)
    print()
    print('ENUMS WITH NO LABEL — each is a word the owner has to decide:')
    for e in sorted(needs_word):
        print('    %s' % e)
    print()
    if ambiguous:
        print()
        print('FIELD NAMES THIS SCRIPT CANNOT RESOLVE TO ONE ENUM — read the line:')
        for f in sorted(ambiguous):
            print('    %s' % f)
        print()
    print('raw-stored-values: a REPORT, not a gate. Read the rows — the five enums above')
    print('that already have labels are pure oversight and cost no Arabic at all.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
