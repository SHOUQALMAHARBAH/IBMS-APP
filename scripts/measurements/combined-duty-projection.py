# -*- coding: utf-8 -*-
"""Which maker/checker pairs SHOW a declared combined-duty act on the record?

When an office declares COMBINED duty segregation, one person may perform both halves of an approval
by stating why. The act is recorded in `CombinedDutyAct`, pointed at from the record's own escape
column, and Part 4 step 5 put it ON THE RECORD so a reader sees that nobody else signed this without
going to find the report at `/internal-controls`.

    python scripts/measurements/combined-duty-projection.py              # the report
    python scripts/measurements/combined-duty-projection.py --self-test  # prove the columns move

## EVERY COLUMN HERE IS PLANTED BEFORE IT IS PUBLISHED

The owner's instruction, after "writes the column" was read as "reads the relation" three times and
writing the lesson down had not worked: **before a number goes in a report, plant the condition it
claims to detect and confirm the number moves. A column that cannot be made to move is not a
measurement.** That is the discipline already applied to guards — the nav-reachability check reported
0 findings until a plant proved it vacuous — turned on published columns.

`--self-test` does it: it mutates the real sources IN MEMORY, re-runs the measurement, and asserts
each figure changed. In memory rather than on disk, so a failing self-test cannot leave the tree
dirty.

**What cannot be planted, stated rather than left implied**: `dormant` is 0 for every pair today, so
planting a `dormant: true` would prove the parser reads a flag and not that the flag is true of
anything. It is labelled an ESTIMATE in the output. Everything else is planted.

## Two earlier versions of this script were wrong, both by loose matching

1. Asking whether a file mentioning a pair's model also mentioned the view ANYWHERE reported
   `Recommendation` as projecting, because the one file that calls the view happens to contain that
   word — the same substring weakness that produced 69 false positives on the permission-reachability
   check.
2. Attributing a call site by the pair's `modelProperty` (`policyChecking`) missed a projection I had
   just added, because the Prisma relation on the parent is named `checking`.

So attribution is an EXPLICIT map from call-site argument to pair, and an argument no row claims is a
loud assertion rather than a silent "not projecting".
"""
import io
import os
import re
import sys

REGISTRY = os.path.join('apps', 'api', 'src', 'common', 'maker-checker-pairs.config.ts')
MODULES = os.path.join('apps', 'api', 'src', 'modules')
VIEW = 'combinedDutyActView'

FIELD = re.compile(r"(\w+):\s*(?:'([^']*)'|(true|false))")

# Which pair each call site of the view belongs to.
#
# MAINTAINED BY HAND AND ASSERTED. Neither automatic key works: the model property is not the Prisma
# relation name on the parent, and matching loosely on the entity name is what produced the
# `Recommendation` false positive. An argument no row claims raises — the same discipline as the i18n
# dictionary registry, which has caught a real omission twice.
# Keyed on (FILE BASENAME, argument), not the argument alone.
#
# `row.combinedDutyAct` appears in TWO pairs' mappers — the commission ledger's and, once KYC gained a
# wire projection, the KYC controller's. With the argument as the sole key the second silently
# collided with the first and the count stayed at 5 after the sixth pair was built. The file
# disambiguates, and the collision is now impossible to express rather than something to notice.
BY_CALL_SITE = {
    ('endorsement.service.ts', 'e.refund.combinedDutyAct'): 'Refund',
    ('policy.service.ts', 'policy.checking.combinedDutyAct'): 'PolicyChecking',
    ('dsr.config.ts', 'row.closureCombinedDutyAct'): 'DataSubjectRequest',
    ('commission.config.ts', 'row.combinedDutyAct'): 'CommissionLedgerEntry',
    ('claim.config.ts', 's.combinedDutyAct'): 'Settlement',
    ('kyc.controller.ts', 'row.combinedDutyAct'): 'KYCRecord',
    ('data-sharing-approval.config.ts', 'row.combinedDutyAct'): 'DataSharingApproval',
    ('disposal-batch.config.ts', 'row.combinedDutyAct'): 'DisposalBatch',
    # Two entries for ONE pair: this module has no view layer, so the controller projects — once for the
    # single-row handlers and once for the list. KYC is the other module shaped this way (§ 1.80).
    ('data-processing-agreement.controller.ts', 'row.combinedDutyAct'): 'DataProcessingAgreement',
    ('complaint.config.ts', 'row.closureCombinedDutyAct'): 'Complaint',
    (
        'incident.config.ts',
        'row.classificationCombinedDutyAct',
    ): 'IncidentReport',
}


def read_sources():
    """{path: text} for the registry and every non-spec module file."""
    out = {REGISTRY: io.open(REGISTRY, encoding='utf-8', errors='replace').read()}
    for root, _, files in os.walk(MODULES):
        for name in files:
            if name.endswith('.ts') and '.spec.' not in name:
                path = os.path.join(root, name)
                out[path] = io.open(path, encoding='utf-8', errors='replace').read()
    return out


def parse_pairs(registry_text):
    body = registry_text[registry_text.index('export const MAKER_CHECKER_REGISTRY'):]
    out = []
    for block in re.findall(r'\{([^{}]*?)\}', body, re.S):
        got = {}
        for m in FIELD.finditer(block):
            got[m.group(1)] = m.group(2) if m.group(2) is not None else m.group(3)
        if 'entityType' in got and 'dbCheckConstraint' in got:
            out.append(got)
    return out


def measure(sources):
    """The whole measurement, from a {path: text} map. The report and the self-test share this."""
    pairs = parse_pairs(sources[REGISTRY])

    call_args = []
    for path, text in sources.items():
        if path.endswith('duty-segregation.view.ts'):
            continue
        base = os.path.basename(path)
        for m in re.finditer(re.escape(VIEW) + r'\s*\(([^)]*)\)', text):
            # `.rstrip(',')` because prettier may wrap a long call so the argument sits on its own
            # line WITH a trailing comma — which changed the captured text without changing the code,
            # and the assertion below correctly refused the unrecognised key rather than silently
            # dropping a real projection. Normalising is the fix; loosening the assertion is not.
            call_args.append((base, m.group(1).strip().rstrip(',').strip()))

    unmapped = [a for a in call_args if a not in BY_CALL_SITE]
    assert not unmapped, (
        'combinedDutyActView is called at %s, which no row of BY_CALL_SITE claims. Add it — '
        'otherwise this script reports a pair as unprojected while a screen is showing it.'
        % unmapped
    )
    projected = {BY_CALL_SITE[a] for a in call_args}

    dormant = [p['entityType'] for p in pairs if p.get('dormant') == 'true']
    live = [p['entityType'] for p in pairs if p.get('dormant') != 'true']

    return {
        'pairs': len(pairs),
        'dormant': dormant,
        'live': len(live),
        'projecting': sorted({e for e in live if e in projected}),
        'writing_only': sorted([e for e in live if e not in projected]),
        'call_sites': len(call_args),
    }


def report():
    r = measure(read_sources())
    assert r['pairs'] == 15, 'expected 15 registered pairs, parsed %d' % r['pairs']

    print('registered maker/checker pairs        %3d' % r['pairs'])
    print('  dormant (ESTIMATE — see header)     %3d' % len(r['dormant']))
    print('  live                                %3d' % r['live'])
    print('    projecting the act on the record  %3d' % len(r['projecting']))
    print('    writing it and showing nobody     %3d' % len(r['writing_only']))
    print()
    print('view call sites found                 %3d' % r['call_sites'])
    print()
    print('PROJECTING: %s' % ', '.join(r['projecting']))
    print()
    print('WRITING ONLY — the record reads as an ordinary two-person approval:')
    for entity in r['writing_only']:
        print('  %s' % entity)
    return 0


def self_test():
    """Plant each column's condition; assert the figure moves."""
    base = read_sources()
    baseline = measure(base)
    failures = []

    def planted(path, find, replace):
        mutated = dict(base)
        assert find in mutated[path], 'self-test plant is STALE: %r not in %s' % (find, path)
        mutated[path] = mutated[path].replace(find, replace, 1)
        return mutated

    def check(name, mutated, key):
        moved = measure(mutated)[key] != baseline[key]
        print('  %-56s %s' % (name, 'ok' if moved else '*** DID NOT MOVE ***'))
        if not moved:
            failures.append(name)

    # 1. The registry count must fall when a pair is removed.
    check(
        'registered pairs falls when a pair is dropped',
        planted(REGISTRY, "entityType: 'Refund',", "notAnEntityType: 'Refund',"),
        'pairs',
    )

    # 2. THE COLUMN THAT WAS WRONG THREE TIMES. Removing a call site must drop `projecting`. The old
    #    heuristic reported a pair as projecting while no call site named it, so removing call sites
    #    could not move it — exactly what this case refuses to let happen again.
    commission = os.path.join(MODULES, 'commission', 'commission.config.ts')
    check(
        'projecting falls when a view call site is removed',
        planted(commission, 'combinedDutyActView(row.combinedDutyAct)', 'null'),
        'projecting',
    )

    # 3. A call site no mapping row claims must RAISE, never read as "not projecting" — which is how
    #    a count silently drifts as pairs are added.
    try:
        measure(
            planted(
                commission,
                'combinedDutyActView(row.combinedDutyAct)',
                'combinedDutyActView(row.notInTheMap)',
            )
        )
        print('  %-56s *** NO ERROR RAISED ***' % 'an unmapped call site is refused')
        failures.append('unmapped call site')
    except AssertionError as err:
        if 'no row of BY_CALL_SITE claims' not in str(err):
            raise
        print('  %-56s ok' % 'an unmapped call site is refused')

    print()
    if failures:
        print('SELF-TEST FAILED: %s' % ', '.join(failures))
        return 1
    print('SELF-TEST PASSED — every planted column moved.')
    print('NOT PLANTABLE, labelled an ESTIMATE above: dormant (0 for every pair today).')
    return 0


if __name__ == '__main__':
    sys.exit(self_test() if '--self-test' in sys.argv else report())
