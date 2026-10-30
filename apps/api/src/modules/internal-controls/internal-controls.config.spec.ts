import { describe, expect, it } from 'vitest';
import {
  buildInternalControlsReport,
  classifyCrossTableRows,
  classifyPairRows,
  MAKER_CHECKER_REGISTRY,
  POLICY_CHECKING_ISSUER_PAIR,
  type MakerCheckerPairResult,
  type PolicyCheckingCrossTableRow,
} from './internal-controls.config';

describe('MAKER_CHECKER_REGISTRY', () => {
  it('has a non-empty entityType/pairLabel/modelProperty/makerField/checkerField/source for every entry', () => {
    for (const pair of MAKER_CHECKER_REGISTRY) {
      expect(pair.entityType.length).toBeGreaterThan(0);
      expect(pair.pairLabel.length).toBeGreaterThan(0);
      expect(pair.modelProperty.length).toBeGreaterThan(0);
      expect(pair.makerField.length).toBeGreaterThan(0);
      expect(pair.checkerField.length).toBeGreaterThan(0);
      expect(pair.source.length).toBeGreaterThan(0);
      // makerField/checkerField must be distinct — a pair checking a field
      // against itself would be a config bug, not a real invariant.
      expect(pair.makerField).not.toBe(pair.checkerField);
    }
  });

  it('names exactly the DB CHECK constraints this process scans', () => {
    /*
     * THE SET, not the count — converted 2026-10-13 under the standing rule that wherever a number
     * stands in for a set of named values, the substitution passes.
     *
     * `toHaveLength(15)` is satisfied by any fifteen entries, including fifteen where one pair's
     * constraint was swapped for another table's. That matters more here than almost anywhere:
     * this registry is what `CHECKER_PERMISSIONS` now derives from, and it is what
     * `duty-segregation-schema.e2e-spec.ts` compares against `pg_constraint`. A silently wrong
     * entry would propagate into both.
     *
     * ALL SIXTEEN carry a constraint name — measured, zero nulls — so every registered pair has a
     * database backstop and not one is enforced in application code alone. That is worth pinning
     * as much as the names themselves: a future pair added with `dbCheckConstraint: null` would be
     * a maker/checker rule the database does not refuse, and it would fail here rather than slip in.
     */
    expect(
      MAKER_CHECKER_REGISTRY.map((p) => p.dbCheckConstraint).sort(),
      'the maker/checker registry no longer names the constraints it did. A pair added, removed or re-pointed changes what the duty-segregation signal reports AND what the schema guard compares against pg_constraint — so it is a deliberate edit here, not a number to bump.',
    ).toEqual(
      [
        'AccessRecertificationItem_maker_checker_distinct',
        'Complaint_closure_maker_checker_distinct',
        'CommissionLedgerEntry_maker_checker_distinct',
        'DataProcessingAgreement_maker_checker_distinct',
        'DataSharingApproval_maker_checker_distinct',
        'DataSubjectRequest_closure_maker_checker_distinct',
        'DisposalBatch_maker_checker_distinct',
        'IncidentReport_classification_maker_checker_distinct',
        'KYCRecord_maker_checker_distinct',
        'NeedsAssessment_approver_maker_checker_distinct',
        'NeedsAssessment_reviewer_maker_checker_distinct',
        'PolicyChecking_maker_checker_distinct',
        'Recommendation_maker_checker_distinct',
        'Refund_maker_checker_distinct',
        /*
         * MODULE 0 CLOSE, DECISION 3 — THE SIXTEENTH PAIR, and this is the deliberate edit the
         * assertion's own message asks for.
         *
         * `RetentionScheduleItem` already had a confirm step — `confirmedByLegalCounselAt`, a date
         * with NO ACTOR — so one person could set a retention period and confirm it as Legal Counsel
         * and nothing could compare them. The period decides when a customer's records are
         * destroyed.
         *
         * Adding it here is what makes it visible to the duty-segregation readiness signal and to
         * the schema guard that compares this list against `pg_constraint` both ways.
         */
        'RetentionScheduleItem_maker_checker_distinct',
        'Settlement_maker_checker_distinct',
      ].sort(),
    );
  });

  it('every dbCheckConstraint is either null or a non-empty, unique string', () => {
    // No type predicate: the registry is `as const` now, so dbCheckConstraint is a literal union and a
    // predicate naming `string` is wider than the parameter. The test only counts, so filtering is enough.
    const named = MAKER_CHECKER_REGISTRY.map((p) => p.dbCheckConstraint).filter(
      (c) => c !== null,
    );
    expect(new Set(named).size).toBe(named.length);
  });

  it('NeedsAssessment contributes two distinct pairs against the same maker field', () => {
    const needsAssessmentPairs = MAKER_CHECKER_REGISTRY.filter(
      (p) => p.entityType === 'NeedsAssessment',
    );
    expect(needsAssessmentPairs).toHaveLength(2);
    expect(
      needsAssessmentPairs.every((p) => p.makerField === 'createdByUserId'),
    ).toBe(true);
    expect(new Set(needsAssessmentPairs.map((p) => p.checkerField)).size).toBe(
      2,
    );
  });
});

describe('classifyPairRows', () => {
  const pair = {
    entityType: 'KYCRecord',
    pairLabel: 'createdByUserId / approvedByUserId',
    makerField: 'createdByUserId',
    checkerField: 'approvedByUserId',
    dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
  };

  it('flags a row where maker and checker are the same user', () => {
    const violations = classifyPairRows(pair, [
      { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: 'user-a' },
    ]);
    expect(violations).toEqual([
      {
        entityType: 'KYCRecord',
        pairLabel: 'createdByUserId / approvedByUserId',
        entityId: 'kyc-1',
        makerField: 'createdByUserId',
        checkerField: 'approvedByUserId',
        userId: 'user-a',
        dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
      },
    ]);
  });

  it('does not flag a row with two distinct users', () => {
    expect(
      classifyPairRows(pair, [
        { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: 'user-b' },
      ]),
    ).toEqual([]);
  });

  it('does not flag a row with no checker decided yet (null)', () => {
    expect(
      classifyPairRows(pair, [
        { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: null },
      ]),
    ).toEqual([]);
  });

  it('does not flag a row with no maker on record (defensive — should not occur given makerField is required in the schema)', () => {
    expect(
      classifyPairRows(pair, [
        { id: 'kyc-1', createdByUserId: null, approvedByUserId: null },
      ]),
    ).toEqual([]);
  });

  it('scans every row independently and returns one violation per bad row', () => {
    const violations = classifyPairRows(pair, [
      { id: 'kyc-1', createdByUserId: 'user-a', approvedByUserId: 'user-b' },
      { id: 'kyc-2', createdByUserId: 'user-c', approvedByUserId: 'user-c' },
      { id: 'kyc-3', createdByUserId: 'user-d', approvedByUserId: null },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].entityId).toBe('kyc-2');
  });
});

describe('classifyCrossTableRows', () => {
  function row(
    over: Partial<PolicyCheckingCrossTableRow> = {},
  ): PolicyCheckingCrossTableRow {
    return {
      id: 'pc-1',
      checkedByUserId: 'user-a',
      policy: { issuedByUserId: 'user-b' },
      ...over,
    };
  }

  it('flags a row where the checker matches the PARENT policy issuer, not a column on the same table', () => {
    const violations = classifyCrossTableRows([
      row({ checkedByUserId: 'user-x', policy: { issuedByUserId: 'user-x' } }),
    ]);
    expect(violations).toEqual([
      {
        entityType: POLICY_CHECKING_ISSUER_PAIR.entityType,
        pairLabel: POLICY_CHECKING_ISSUER_PAIR.pairLabel,
        entityId: 'pc-1',
        makerField: 'issuedByUserId',
        checkerField: 'checkedByUserId',
        userId: 'user-x',
        dbCheckConstraint: null,
      },
    ]);
  });

  it('does not flag a distinct issuer/checker pair', () => {
    expect(classifyCrossTableRows([row()])).toEqual([]);
  });

  it('does not flag a row with no policy loaded or no issuer recorded yet', () => {
    expect(classifyCrossTableRows([row({ policy: null })])).toEqual([]);
    expect(
      classifyCrossTableRows([row({ policy: { issuedByUserId: null } })]),
    ).toEqual([]);
  });

  it('does not flag a row with no checker decided yet', () => {
    expect(classifyCrossTableRows([row({ checkedByUserId: null })])).toEqual(
      [],
    );
  });
});

describe('buildInternalControlsReport', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');

  it('aggregates rowsChecked/violations across every pair', () => {
    const pairResults: MakerCheckerPairResult[] = [
      {
        entityType: 'KYCRecord',
        pairLabel: 'createdByUserId / approvedByUserId',
        rowsChecked: 10,
        violations: [],
        dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
        dormant: false,
        truncated: false,
      },
      {
        entityType: 'DisposalBatch',
        pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
        rowsChecked: 0,
        violations: [
          {
            entityType: 'DisposalBatch',
            pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
            entityId: 'db-1',
            makerField: 'nominatedByUserId',
            checkerField: 'dpoApprovedByUserId',
            userId: 'user-a',
            dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
          },
        ],
        dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
        dormant: true,
        truncated: false,
      },
    ];

    const report = buildInternalControlsReport(
      pairResults,
      now,
      new Map([['user-1', 'سامر عبدالله الحوراني']]),
    );
    expect(report.generatedAt).toBe(now.toISOString());
    expect(report.pairsScanned).toBe(2);
    expect(report.totalRowsChecked).toBe(10);
    expect(report.violations).toHaveLength(1);
    expect(report.byPair).toEqual([
      {
        entityType: 'KYCRecord',
        pairLabel: 'createdByUserId / approvedByUserId',
        rowsChecked: 10,
        violationCount: 0,
        dbCheckConstraint: 'KYCRecord_maker_checker_distinct',
        dormant: false,
        truncated: false,
      },
      {
        entityType: 'DisposalBatch',
        pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
        rowsChecked: 0,
        violationCount: 1,
        dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
        dormant: true,
        truncated: false,
      },
    ]);
  });

  /* ITEM 1 — the violating colleague is named, and the OTHER branch is asserted beside it: an
   * account that has since been deleted reports NO name rather than its uuid. A test asserting
   * only the resolved name would pass against a `?? v.userId` fallback, which is the edit somebody
   * reaches for because it always produces something to render. */
  it('names the violating colleague, and reports NO name when the account is gone', () => {
    const violation = {
      entityType: 'DisposalBatch',
      pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
      entityId: 'batch-1',
      makerField: 'nominatedByUserId',
      checkerField: 'dpoApprovedByUserId',
      userId: 'user-1',
      dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
    };
    const pairResults = [
      {
        entityType: 'DisposalBatch',
        pairLabel: 'nominatedByUserId / dpoApprovedByUserId',
        rowsChecked: 1,
        violations: [violation],
        dbCheckConstraint: 'DisposalBatch_maker_checker_distinct',
        dormant: false,
        truncated: false,
      },
    ];
    const named = buildInternalControlsReport(
      pairResults,
      now,
      new Map([['user-1', 'سامر عبدالله الحوراني']]),
    );
    expect(named.violations[0].userName).toBe('سامر عبدالله الحوراني');

    const unnamed = buildInternalControlsReport(pairResults, now, new Map());
    expect(unnamed.violations[0].userName).toBeNull();
    expect(unnamed.violations[0].userName).not.toBe('user-1');
  });

  it('reports zero pairs/rows/violations for an empty scan', () => {
    const report = buildInternalControlsReport([], now, new Map());
    expect(report).toEqual({
      generatedAt: now.toISOString(),
      pairsScanned: 0,
      totalRowsChecked: 0,
      violations: [],
      byPair: [],
    });
  });
});
