import { describe, expect, it } from 'vitest';
import {
  complianceCalendarItemAuditSnapshot,
  deriveComplianceCalendarItemView,
  type ComplianceCalendarItemRow,
} from './compliance-calendar.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(
  overrides: Partial<ComplianceCalendarItemRow> = {},
): ComplianceCalendarItemRow {
  return {
    id: 'item-1',
    obligationName: 'Quarterly CBJ prudential return',
    ownerUserId: 'user-1',
    dueDate: new Date('2026-10-01T00:00:00.000Z'),
    evidenceOfSubmissionRef: null,
    submittedAt: null,
    ...overrides,
  };
}

describe('deriveComplianceCalendarItemView (Process 51)', () => {
  it('is not overdue when unsubmitted and the due date is in the future', () => {
    const view = deriveComplianceCalendarItemView(row(), NOW);
    expect(view.isSubmitted).toBe(false);
    expect(view.isOverdue).toBe(false);
  });

  it('is overdue when unsubmitted and the due date has passed', () => {
    const view = deriveComplianceCalendarItemView(
      row({ dueDate: new Date('2026-01-01T00:00:00.000Z') }),
      NOW,
    );
    expect(view.isOverdue).toBe(true);
  });

  it('is never overdue once submitted, even past its due date', () => {
    const view = deriveComplianceCalendarItemView(
      row({
        dueDate: new Date('2026-01-01T00:00:00.000Z'),
        evidenceOfSubmissionRef: 'doc://ref-1',
        submittedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
      NOW,
    );
    expect(view.isSubmitted).toBe(true);
    expect(view.isOverdue).toBe(false);
  });
});

describe('complianceCalendarItemAuditSnapshot (Process 51)', () => {
  it('includes obligationName / evidenceOfSubmissionRef verbatim (internal labels, no guard needed)', () => {
    const snapshot = complianceCalendarItemAuditSnapshot(
      row({ evidenceOfSubmissionRef: 'doc://ref-1' }),
    );
    expect(snapshot.obligationName).toBe('Quarterly CBJ prudential return');
    expect(snapshot.evidenceOfSubmissionRef).toBe('doc://ref-1');
  });
});
