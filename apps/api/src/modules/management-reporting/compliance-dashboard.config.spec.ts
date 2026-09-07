import { describe, expect, it } from 'vitest';
import {
  buildComplianceDashboardSummary,
  buildRegulatoryFilingsSummary,
  COMPLAINT_CATEGORY_KEYS,
  DSR_STATUS_KEYS,
  INCIDENT_STATUS_KEYS,
  KYC_STATUS_KEYS,
  type StatusCountRow,
} from './compliance-dashboard.config';
import type { ComplianceCalendarItemRow } from '../compliance-risk/compliance-calendar.config';

function calendarRow(
  over: Partial<ComplianceCalendarItemRow>,
): ComplianceCalendarItemRow {
  return {
    id: 'ccal-1',
    obligationName: 'CBJ quarterly return',
    ownerUserId: 'u-compliance',
    dueDate: new Date('2026-08-01T00:00:00.000Z'),
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    ...over,
  };
}

describe('buildRegulatoryFilingsSummary', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');

  it('splits rows into submitted, overdue, and pending', () => {
    const rows: ComplianceCalendarItemRow[] = [
      calendarRow({
        id: 'a',
        submittedAt: new Date('2026-08-15T00:00:00.000Z'),
      }), // submitted
      calendarRow({ id: 'b', dueDate: new Date('2026-01-01T00:00:00.000Z') }), // overdue
      calendarRow({ id: 'c', dueDate: new Date('2027-01-01T00:00:00.000Z') }), // pending (not yet due)
    ];
    const summary = buildRegulatoryFilingsSummary(rows, now);
    expect(summary).toEqual({
      totalCount: 3,
      submittedCount: 1,
      overdueCount: 1,
      pendingCount: 1,
    });
  });

  it('returns all zeros for no obligations', () => {
    expect(buildRegulatoryFilingsSummary([], now)).toEqual({
      totalCount: 0,
      submittedCount: 0,
      overdueCount: 0,
      pendingCount: 0,
    });
  });
});

describe('buildComplianceDashboardSummary', () => {
  const now = new Date('2026-09-07T00:00:00.000Z');

  function baseInput() {
    return {
      now,
      kycByStatus: [] as StatusCountRow[],
      complaintsByStatus: [] as StatusCountRow[],
      complaintsByCategory: [] as StatusCountRow[],
      amlOpenByPatternType: [] as StatusCountRow[],
      lastSelfApprovalScan: null,
      regulatoryFilingRows: [] as ComplianceCalendarItemRow[],
      dsrByStatus: [] as StatusCountRow[],
      incidentByStatus: [] as StatusCountRow[],
      dpiaByOutcome: [] as StatusCountRow[],
      dpiaPendingReviewCount: 0,
    };
  }

  it('zero-fills every KYC status, including ones with no rows', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      kycByStatus: [
        { key: 'APPROVED', count: 12 },
        { key: 'PERIODIC_REVIEW_DUE', count: 3 },
      ],
    });
    expect(summary.kyc.byStatus.APPROVED).toBe(12);
    expect(summary.kyc.byStatus.PERIODIC_REVIEW_DUE).toBe(3);
    expect(summary.kyc.byStatus.DRAFT).toBe(0);
    expect(Object.keys(summary.kyc.byStatus).sort()).toEqual(
      [...KYC_STATUS_KEYS].sort(),
    );
  });

  it('zero-fills complaint categories, including "uncategorized"', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      complaintsByCategory: [
        { key: 'denied_claim', count: 2 },
        { key: 'uncategorized', count: 5 },
      ],
    });
    expect(summary.complaints.byCategory.denied_claim).toBe(2);
    expect(summary.complaints.byCategory.uncategorized).toBe(5);
    expect(summary.complaints.byCategory.other).toBe(0);
    expect(Object.keys(summary.complaints.byCategory).sort()).toEqual(
      [...COMPLAINT_CATEGORY_KEYS].sort(),
    );
  });

  it('computes open DSRs as every status except CLOSED', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      dsrByStatus: [
        { key: 'RECEIVED', count: 3 },
        { key: 'IN_PROGRESS', count: 2 },
        { key: 'CLOSED', count: 10 },
      ],
    });
    expect(summary.dsr.openCount).toBe(5); // 3 + 2, CLOSED excluded
    expect(summary.dsr.byStatus.CLOSED).toBe(10);
    expect(Object.keys(summary.dsr.byStatus).sort()).toEqual(
      [...DSR_STATUS_KEYS].sort(),
    );
  });

  it('computes open breach-register entries as every status except CLOSED', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      incidentByStatus: [
        { key: 'REPORTED', count: 1 },
        { key: 'CLOSED', count: 4 },
      ],
    });
    expect(summary.breachRegister.openCount).toBe(1);
    expect(Object.keys(summary.breachRegister.byStatus).sort()).toEqual(
      [...INCIDENT_STATUS_KEYS].sort(),
    );
  });

  it('sums open AML alerts across pattern types and carries the byPatternType breakdown', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      amlOpenByPatternType: [
        { key: 'large_premium_payment', count: 2 },
        { key: 'frequent_cancellations', count: 1 },
      ],
    });
    expect(summary.complianceExceptions.openAmlAlertsCount).toBe(3);
    expect(summary.complianceExceptions.amlByPatternType).toEqual({
      large_premium_payment: 2,
      frequent_cancellations: 1,
    });
  });

  it('carries the last self-approval scan when given, and null when none has ever run', () => {
    const withScan = buildComplianceDashboardSummary({
      ...baseInput(),
      lastSelfApprovalScan: {
        asOf: new Date('2026-09-01T00:00:00.000Z'),
        violationCount: 0,
      },
    });
    expect(withScan.complianceExceptions.lastSelfApprovalScan).toEqual({
      asOf: '2026-09-01T00:00:00.000Z',
      violationCount: 0,
    });

    const withoutScan = buildComplianceDashboardSummary(baseInput());
    expect(withoutScan.complianceExceptions.lastSelfApprovalScan).toBeNull();
  });

  it('carries the DPIA pending-review count and zero-fills the outcome breakdown', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      dpiaByOutcome: [{ key: 'AUTO_APPROVED', count: 4 }],
      dpiaPendingReviewCount: 2,
    });
    expect(summary.dpiaBacklog.pendingReviewCount).toBe(2);
    expect(summary.dpiaBacklog.byOutcome).toEqual({
      AUTO_APPROVED: 4,
      DPO_REVIEW_REQUIRED: 0,
      ESCALATED_FULL_DPIA: 0,
    });
  });

  it('composes the regulatory filings section from raw calendar rows', () => {
    const summary = buildComplianceDashboardSummary({
      ...baseInput(),
      regulatoryFilingRows: [
        calendarRow({ id: 'a', dueDate: new Date('2026-01-01T00:00:00.000Z') }),
      ],
    });
    expect(summary.regulatoryFilings).toEqual({
      totalCount: 1,
      submittedCount: 0,
      overdueCount: 1,
      pendingCount: 0,
    });
  });
});
