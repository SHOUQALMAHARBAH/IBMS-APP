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

  it('has exactly 15 entries — one per DB CHECK constraint this process scans', () => {
    expect(MAKER_CHECKER_REGISTRY).toHaveLength(15);
  });

  it('every dbCheckConstraint is either null or a non-empty, unique string', () => {
    const named = MAKER_CHECKER_REGISTRY.map((p) => p.dbCheckConstraint).filter(
      (c): c is string => c !== null,
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

    const report = buildInternalControlsReport(pairResults, now);
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

  it('reports zero pairs/rows/violations for an empty scan', () => {
    const report = buildInternalControlsReport([], now);
    expect(report).toEqual({
      generatedAt: now.toISOString(),
      pairsScanned: 0,
      totalRowsChecked: 0,
      violations: [],
      byPair: [],
    });
  });
});
