import { describe, expect, it } from 'vitest';
import {
  classifyRenewalCaseForRetention,
  deriveRetentionCaseView,
  isRenewalCaseConcluded,
  isRetentionCaseReason,
  isTerminalRetentionCaseStatus,
  retentionCaseAuditSnapshot,
  type RetentionCaseRow,
} from './retention-case.config';

const NOW = new Date('2026-09-04T00:00:00.000Z');
// Well past the 30-business-day threshold from NOW.
const LONG_AGO = new Date('2026-06-01T00:00:00.000Z');
// Well within the threshold.
const RECENTLY = new Date('2026-09-01T00:00:00.000Z');

describe('classifyRenewalCaseForRetention (Process 46)', () => {
  it('LAPSED -> lapse_risk, regardless of how recently it was triggered', () => {
    expect(
      classifyRenewalCaseForRetention(
        { status: 'LAPSED', triggeredAt: RECENTLY },
        NOW,
      ),
    ).toBe('lapse_risk');
  });

  it('a stale, unresolved case (RENEWAL_DUE past the threshold) -> renewal_inactivity', () => {
    expect(
      classifyRenewalCaseForRetention(
        { status: 'RENEWAL_DUE', triggeredAt: LONG_AGO },
        NOW,
      ),
    ).toBe('renewal_inactivity');
  });

  it('every non-terminal status is eligible for the inactivity check, not just RENEWAL_DUE', () => {
    for (const status of [
      'IN_PROGRESS',
      'QUOTES_OBTAINED',
      'RECOMMENDED',
      'CLIENT_DECISION',
    ] as const) {
      expect(
        classifyRenewalCaseForRetention({ status, triggeredAt: LONG_AGO }, NOW),
      ).toBe('renewal_inactivity');
    }
  });

  it('a fresh, unresolved case -> null (not due yet)', () => {
    expect(
      classifyRenewalCaseForRetention(
        { status: 'RENEWAL_DUE', triggeredAt: RECENTLY },
        NOW,
      ),
    ).toBeNull();
  });

  it('RENEWED -> null, even if triggered long ago', () => {
    expect(
      classifyRenewalCaseForRetention(
        { status: 'RENEWED', triggeredAt: LONG_AGO },
        NOW,
      ),
    ).toBeNull();
  });

  it('CANCELLED -> null, even if triggered long ago', () => {
    expect(
      classifyRenewalCaseForRetention(
        { status: 'CANCELLED', triggeredAt: LONG_AGO },
        NOW,
      ),
    ).toBeNull();
  });

  it('isRenewalCaseConcluded is true only for RENEWED / CANCELLED, LAPSED is NOT concluded', () => {
    expect(isRenewalCaseConcluded('RENEWED')).toBe(true);
    expect(isRenewalCaseConcluded('CANCELLED')).toBe(true);
    expect(isRenewalCaseConcluded('LAPSED')).toBe(false);
    expect(isRenewalCaseConcluded('RENEWAL_DUE')).toBe(false);
  });
});

describe('isRetentionCaseReason / isTerminalRetentionCaseStatus (Process 46)', () => {
  it('accepts the two documented reasons, rejects anything else', () => {
    expect(isRetentionCaseReason('renewal_inactivity')).toBe(true);
    expect(isRetentionCaseReason('lapse_risk')).toBe(true);
    expect(isRetentionCaseReason('churn')).toBe(false);
  });

  it('only "closed" is terminal', () => {
    expect(isTerminalRetentionCaseStatus('closed')).toBe(true);
    expect(isTerminalRetentionCaseStatus('open')).toBe(false);
  });
});

describe('deriveRetentionCaseView (Process 46)', () => {
  const row: RetentionCaseRow = {
    id: 'rc-1',
    customerId: 'cust-1',
    reason: 'lapse_risk',
    status: 'open',
    createdAt: new Date('2026-09-04T09:00:00.000Z'),
    closedAt: null,
  };

  it('renders an open case with ISO timestamps', () => {
    expect(deriveRetentionCaseView(row)).toEqual({
      id: 'rc-1',
      customerId: 'cust-1',
      reason: 'lapse_risk',
      status: 'open',
      isClosed: false,
      createdAt: '2026-09-04T09:00:00.000Z',
      closedAt: null,
    });
  });

  it('a closed case carries closedAt + isClosed: true', () => {
    const v = deriveRetentionCaseView({
      ...row,
      status: 'closed',
      closedAt: new Date('2026-09-05T09:00:00.000Z'),
    });
    expect(v.isClosed).toBe(true);
    expect(v.closedAt).toBe('2026-09-05T09:00:00.000Z');
  });
});

describe('retentionCaseAuditSnapshot (Process 46)', () => {
  it('carries ids + reason + status only', () => {
    expect(
      retentionCaseAuditSnapshot({
        retentionCaseId: 'rc-1',
        customerId: 'cust-1',
        reason: 'renewal_inactivity',
        status: 'open',
      }),
    ).toEqual({
      retentionCaseId: 'rc-1',
      customerId: 'cust-1',
      reason: 'renewal_inactivity',
      status: 'open',
    });
  });
});
