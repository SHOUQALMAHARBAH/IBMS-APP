# -*- coding: utf-8 -*-
"""Which maker/checker pairs SHOW a declared combined-duty act on the record?

When an office declares COMBINED mode, one person may perform both halves of an approval by stating
why. The act is recorded in `CombinedDutyAct` and pointed at from the record's own escape column, and
step 5 of the duty-segregation plan put it ON THE RECORD so a reader sees that nobody else signed
this without going to find a report.

That was built for ONE pair. This counts the rest.

  registered pairs        the 15 in MAKER_CHECKER_REGISTRY, which a test pins against pg_constraint
  dormant                 no application code writes the model at all (M06/M07/M08) — nothing to show
  live                    the remainder: a real act can exist on these
  projecting              the record's own read renders the act via `combinedDutyActView`
  writing only            the service sets the escape column and no reader ever surfaces it

A pair that WRITES the act and never shows it is not broken — the act is in the report at
`/internal-controls` — but the record itself then looks like an ordinary two-person approval, which
is the thing step 5 exists to prevent.

Run:  python scripts/measurements/combined-duty-projection.py
"""
import io
import os
import re
import sys

REGISTRY = os.path.join('apps', 'api', 'src', 'common', 'maker-checker-pairs.config.ts')
MODULES = os.path.join('apps', 'api', 'src', 'modules')
VIEW = 'combinedDutyActView'

FIELD = re.compile(r"(\w+):\s*(?:'([^']*)'|(true|false))")


def pairs():
    src = io.open(REGISTRY, encoding='utf-8').read()
    start = src.index('export const MAKER_CHECKER_REGISTRY')
    body = src[start:]
    out = []
    for block in re.findall(r'\{([^{}]*?)\}', body, re.S):
        got = {}
        for m in FIELD.finditer(block):
            got[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
        if 'entityType' in got and 'dbCheckConstraint' in got:
            out.append(got)
    # Pinned against the registry's own documented count, so a parser that silently matches fewer
    # blocks cannot report that everything is fine.
    assert len(out) == 15, 'expected 15 registered pairs, parsed %d' % len(out)
    return out


def service_files():
    for root, _, files in os.walk(MODULES):
        for name in files:
            if name.endswith('.ts') and '.spec.' not in name:
                yield os.path.join(root, name)


def main():
    all_pairs = pairs()
    sources = {p: io.open(p, encoding='utf-8', errors='replace').read() for p in service_files()}

    # Every argument passed to the view, across the whole api. This is the authoritative set: a pair
    # projects the act only if one of these names its own relation.
    call_args = []
    for path, src in sources.items():
        if path.endswith('duty-segregation.view.ts'):
            continue
        for m in re.finditer(re.escape(VIEW) + r'\s*\(([^)]*)\)', src):
            call_args.append(m.group(1))

    # Every argument the view is called with, and which PAIR each one belongs to.
    #
    # An EXPLICIT map, because neither automatic key works. The model property (`policyChecking`) is
    # not the Prisma relation name on the parent (`policy.checking`), so matching on it silently
    # missed a projection I had just added and reported 1 where the answer was 2. Matching loosely on
    # the entity name is what produced the `Recommendation` false positive in the first version.
    #
    # So the mapping is maintained by hand and ASSERTED: an argument no row claims is a loud error,
    # not a silent miss. Same discipline as the i18n dictionary registry, which has caught a real
    # omission twice.
    BY_ARGUMENT = {
        'e.refund.combinedDutyAct': 'Refund',
        'policy.checking.combinedDutyAct': 'PolicyChecking',
    }

    unmapped = [a.strip() for a in call_args if a.strip() not in BY_ARGUMENT]
    assert not unmapped, (
        'combinedDutyActView is called with %s, which no row of BY_ARGUMENT claims. Add it — '
        'otherwise this script reports a pair as unprojected while a screen is showing it.'
        % unmapped
    )
    PROJECTED_ENTITIES = {
        BY_ARGUMENT[a.strip()] for a in call_args if a.strip() in BY_ARGUMENT
    }

    projecting = []
    writing_only = []
    dormant = []

    for pair in all_pairs:
        entity = pair['entityType']
        if pair.get('dormant') == 'true':
            dormant.append(entity)
            continue
        # EXACT, not "a file that mentions both". The first version asked whether any file
        # mentioning this pair's modelProperty also mentioned the view anywhere, and reported
        # `Recommendation` as projecting because the one file that calls the view happens to mention
        # that word — the same substring weakness that produced 69 false positives on the
        # permission-reachability check. A call site is attributed by the RELATION IN ITS ARGUMENT.
        shows = entity in PROJECTED_ENTITIES
        (projecting if shows else writing_only).append(entity)

    print('registered maker/checker pairs        %3d' % len(all_pairs))
    print('  dormant (no writer at all)          %3d' % len(dormant))
    print('  live                                %3d' % (len(all_pairs) - len(dormant)))
    print('    projecting the act on the record  %3d' % len(projecting))
    print('    writing it and showing nobody     %3d' % len(writing_only))
    print()
    print('view call sites found              %3d' % len(call_args))
    print()
    if projecting:
        print('PROJECTING: %s' % ', '.join(sorted(projecting)))
    if writing_only:
        print()
        print('WRITING ONLY — the record reads as an ordinary two-person approval:')
        for entity in sorted(writing_only):
            print('  %s' % entity)
    if dormant:
        print()
        print('DORMANT (nothing writes the model): %s' % ', '.join(sorted(dormant)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
