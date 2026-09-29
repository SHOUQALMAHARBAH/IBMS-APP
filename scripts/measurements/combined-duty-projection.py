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
    ('endorsement.service.ts', 'e.refund.combinedDutyAct'): 'Refund_maker_checker_distinct',
    ('policy.service.ts', 'policy.checking.combinedDutyAct'): 'PolicyChecking_maker_checker_distinct',
    ('dsr.config.ts', 'row.closureCombinedDutyAct'): 'DataSubjectRequest_closure_maker_checker_distinct',
    ('commission.config.ts', 'row.combinedDutyAct'): 'CommissionLedgerEntry_maker_checker_distinct',
    ('claim.config.ts', 's.combinedDutyAct'): 'Settlement_maker_checker_distinct',
    ('kyc.controller.ts', 'row.combinedDutyAct'): 'KYCRecord_maker_checker_distinct',
    ('data-sharing-approval.config.ts', 'row.combinedDutyAct'): 'DataSharingApproval_maker_checker_distinct',
    ('disposal-batch.config.ts', 'row.combinedDutyAct'): 'DisposalBatch_maker_checker_distinct',
    # Two entries for ONE pair: this module has no view layer, so the controller projects — once for the
    # single-row handlers and once for the list. KYC is the other module shaped this way (§ 1.80).
    ('data-processing-agreement.controller.ts', 'row.combinedDutyAct'): 'DataProcessingAgreement_maker_checker_distinct',
    ('complaint.config.ts', 'row.closureCombinedDutyAct'): 'Complaint_closure_maker_checker_distinct',
    (
        'incident.config.ts',
        'row.classificationCombinedDutyAct',
    ): 'IncidentReport_classification_maker_checker_distinct',
    ('recommendation.service.ts', 'rec.combinedDutyAct'): 'Recommendation_maker_checker_distinct',
    # TWO rows for the two pairs on one table, which is what makes them separately countable. A controller
    # projecting one act into both fields would still have two call sites and would still count as two —
    # that property is pinned by the wire assertion in `duty-segregation-combined.e2e-spec.ts`, not here.
    (
        'needs-assessment.controller.ts',
        'row.reviewerCombinedDutyAct',
    ): 'NeedsAssessment_reviewer_maker_checker_distinct',
    (
        'needs-assessment.controller.ts',
        'row.approverCombinedDutyAct',
    ): 'NeedsAssessment_approver_maker_checker_distinct',
    # TWO call sites for ONE pair, which is the opposite of the NeedsAssessment case above: this row has
    # two RELATIONS for one constraint — the act on the ARRANGEMENT (she was set to review her own access)
    # and the act on the DECISION (she did). Both map to the same pair, so either one alone counts it as
    # projecting; that they are shown SEPARATELY is pinned by `access-recertification.spec.ts`, not here.
    (
        'access-recertification.service.ts',
        'item.combinedDutyAct',
    ): 'AccessRecertificationItem_maker_checker_distinct',
    (
        'access-recertification.service.ts',
        'item.decisionCombinedDutyAct',
    ): 'AccessRecertificationItem_maker_checker_distinct',
}


def key(pair):
    """
    A pair's identity is its CONSTRAINT, never its table.

    `NeedsAssessment` carries TWO pairs — reviewer and approver — with two escape columns, deliberately,
    because one shared column would let a declared combined REVIEW excuse a self-APPROVAL. Keying this
    measurement on `entityType` collapses them, so it would report the table as projecting the moment one
    of its two acts reached a screen. That is the schema's own rule broken in the measurement.
    """
    return pair['dbCheckConstraint']


def label(pair):
    """What a reader sees. The constraint name already distinguishes the two NeedsAssessment pairs."""
    return pair['dbCheckConstraint']


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

    dormant = [label(p) for p in pairs if p.get('dormant') == 'true']
    live = [p for p in pairs if p.get('dormant') != 'true']

    return {
        'pairs': len(pairs),
        'dormant': dormant,
        'live': len(live),
        'projecting': sorted({label(p) for p in live if key(p) in projected}),
        'writing_only': sorted([label(p) for p in live if key(p) not in projected]),
        'call_sites': len(call_args),
    }


def report():
    sources = read_sources()
    r = measure(sources)
    assert r['pairs'] == 15, 'expected 15 registered pairs, parsed %d' % r['pairs']

    # A BY_CALL_SITE value must name a REAL constraint. Without this, a typo'd or reconstructed constraint
    # name makes its pair read as UNPROJECTED while a screen is showing it — under-reporting, the direction
    # that looks like honest remaining work. Two reconstructed names were caught exactly this way.
    #
    # It lives here and NOT in `measure()`: inside the measured seam it fired on the self-test's own first
    # plant, which drops a pair from the registry on purpose.
    known = {p['dbCheckConstraint'] for p in parse_pairs(sources[REGISTRY])}
    bogus = sorted(v for v in set(BY_CALL_SITE.values()) if v not in known)
    assert not bogus, (
        'BY_CALL_SITE names %s, which is not a `dbCheckConstraint` in the registry. Copy the name from '
        '`maker-checker-pairs.config.ts` rather than reconstructing it.' % bogus
    )

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
