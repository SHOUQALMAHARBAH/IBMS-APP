import { describe, expect, it } from 'vitest';
import {
  applyDsrExtension,
  canApplyDsrExtension,
  deriveDsrView,
  dsrCreateAuditSnapshot,
  dsrSlaWorkflowFor,
  dsrUpdateAuditSnapshot,
  isDsrClosed,
  isDsrProcessed,
  type DataSubjectRequestRow,
} from './dsr.config';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function row(
  overrides: Partial<DataSubjectRequestRow> = {},
): DataSubjectRequestRow {
  return {
    id: 'dsr-1',
    customerId: 'cust-1',
    insuredPersonId: null,
    type: 'ACCESS',
    status: 'RECEIVED',
    receivedAt: new Date('2026-09-01T09:00:00.000Z'),
    identityVerifiedAt: null,
    slaDueAt: new Date('2026-10-01T00:00:00.000Z'),
    accessExtensionAppliedAt: null,
    extensionReason: null,
    retentionScheduleReference: null,
    partialFulfilmentJustification: null,
    closedAt: null,
    dpoHandlerUserId: null,
    processedByUserId: null,
    closedByUserId: null,
    rejectionReason: null,
    noOpenRetentionHoldConfirmedAt: null,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    ...overrides,
  };
}

describe('dsrSlaWorkflowFor (M04)', () => {
  it('routes ACCESS to dsr_access_deletion', () => {
    expect(dsrSlaWorkflowFor('ACCESS')).toBe('dsr_access_deletion');
  });
  it('routes DELETION to dsr_access_deletion', () => {
    expect(dsrSlaWorkflowFor('DELETION')).toBe('dsr_access_deletion');
  });
  it('routes CORRECTION to dsr_correction_objection', () => {
    expect(dsrSlaWorkflowFor('CORRECTION')).toBe('dsr_correction_objection');
  });
  it('routes OBJECTION to dsr_correction_objection', () => {
    expect(dsrSlaWorkflowFor('OBJECTION')).toBe('dsr_correction_objection');
  });
});

describe('canApplyDsrExtension (M04)', () => {
  it('is true only for ACCESS', () => {
    expect(canApplyDsrExtension('ACCESS')).toBe(true);
    expect(canApplyDsrExtension('DELETION')).toBe(false);
    expect(canApplyDsrExtension('CORRECTION')).toBe(false);
    expect(canApplyDsrExtension('OBJECTION')).toBe(false);
  });
});

describe('applyDsrExtension (M04)', () => {
  it('adds 15 business days to the CURRENT due date, not from now', () => {
    // 2026-09-06 is a Sunday (Jordan weekend is Fri/Sat); +15 business days.
    const current = new Date('2026-09-06T00:00:00.000Z');
    const extended = applyDsrExtension(current);
    expect(extended.getTime()).toBeGreaterThan(current.getTime());
    // 15 business days skipping Fri/Sat from 2026-09-06 lands on 2026-09-27.
    expect(extended.toISOString().slice(0, 10)).toBe('2026-09-27');
  });
});

describe('isDsrClosed / isDsrProcessed (M04)', () => {
  it('CLOSED is the only closed status', () => {
    expect(isDsrClosed('CLOSED')).toBe(true);
    expect(isDsrClosed('FULFILLED')).toBe(false);
  });
  it('FULFILLED / PARTIALLY_FULFILLED / REJECTED are processed, others are not', () => {
    expect(isDsrProcessed('FULFILLED')).toBe(true);
    expect(isDsrProcessed('PARTIALLY_FULFILLED')).toBe(true);
    expect(isDsrProcessed('REJECTED')).toBe(true);
    expect(isDsrProcessed('IN_PROGRESS')).toBe(false);
    expect(isDsrProcessed('CLOSED')).toBe(false);
  });
});

describe('deriveDsrView (M04)', () => {
  it('is not overdue when the due date is in the future', () => {
    const view = deriveDsrView(
      row({ slaDueAt: new Date('2027-01-01T00:00:00.000Z') }),
      NOW,
    );
    expect(view.isOverdue).toBe(false);
  });

  it('is overdue when the due date has passed and status is not CLOSED', () => {
    const view = deriveDsrView(
      row({
        status: 'IN_PROGRESS',
        slaDueAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      NOW,
    );
    expect(view.isOverdue).toBe(true);
  });

  it('is never overdue once CLOSED, even past its due date', () => {
    const view = deriveDsrView(
      row({
        status: 'CLOSED',
        slaDueAt: new Date('2026-01-01T00:00:00.000Z'),
        closedAt: new Date('2026-01-05T00:00:00.000Z'),
      }),
      NOW,
    );
    expect(view.isOverdue).toBe(false);
  });

  it('serializes null timestamps as null, not undefined', () => {
    const view = deriveDsrView(row(), NOW);
    expect(view.identityVerifiedAt).toBeNull();
    expect(view.accessExtensionAppliedAt).toBeNull();
    expect(view.closedAt).toBeNull();
  });
});

describe('audit snapshots (M04)', () => {
  it('CREATE snapshot carries ids/type/status/dates', () => {
    const snapshot = dsrCreateAuditSnapshot(row());
    expect(snapshot.dataSubjectRequestId).toBe('dsr-1');
    expect(snapshot.type).toBe('ACCESS');
    expect(snapshot.status).toBe('RECEIVED');
  });

  it('UPDATE snapshot carries the reason fields verbatim (staff-authored, the #41/#42 precedent)', () => {
    const snapshot = dsrUpdateAuditSnapshot(
      row({
        status: 'REJECTED',
        rejectionReason: 'Identity could not be verified.',
      }),
    );
    expect(snapshot.rejectionReason).toBe('Identity could not be verified.');
  });

  it('UPDATE snapshot carries the DELETION retention-hold attestation timestamp (review-fix regression)', () => {
    const confirmedAt = new Date('2026-09-10T00:00:00.000Z');
    const snapshot = dsrUpdateAuditSnapshot(
      row({
        type: 'DELETION',
        status: 'FULFILLED',
        noOpenRetentionHoldConfirmedAt: confirmedAt,
      }),
    );
    expect(snapshot.noOpenRetentionHoldConfirmedAt).toBe(
      confirmedAt.toISOString(),
    );
  });
});
