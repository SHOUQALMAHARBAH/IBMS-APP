import { describe, expect, it } from 'vitest';
import {
  computeDaysUntilDue,
  summarizeConsentStatus,
} from './dpo-workspace.config';
import type { ConsentRecordView } from './consent.config';

describe('computeDaysUntilDue', () => {
  it('is positive for a future due date', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(computeDaysUntilDue('2026-09-10T00:00:00.000Z', now)).toBe(3);
  });

  it('is negative for an already-overdue due date', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(computeDaysUntilDue('2026-09-04T00:00:00.000Z', now)).toBe(-3);
  });
});

const consentRow = (
  over: Partial<ConsentRecordView> = {},
): ConsentRecordView => ({
  id: 'c-1',
  customerId: 'cust-1',
  insuredPersonId: null,
  leadId: null,
  purpose: 'MARKETING',
  isMarketing: true,
  granted: true,
  consentTextVersion: 'v1',
  grantedAt: '2026-09-01T00:00:00.000Z',
  withdrawnAt: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('summarizeConsentStatus', () => {
  it('buckets active/withdrawn/declined correctly', () => {
    const summary = summarizeConsentStatus([
      consentRow({ isActive: true }),
      consentRow({ isActive: false, withdrawnAt: '2026-09-05T00:00:00.000Z' }),
      consentRow({ isActive: false, withdrawnAt: null, granted: false }),
    ]);
    expect(summary).toEqual({
      activeCount: 1,
      withdrawnCount: 1,
      declinedCount: 1,
    });
  });

  it('returns all-zero counts for an empty list', () => {
    expect(summarizeConsentStatus([])).toEqual({
      activeCount: 0,
      withdrawnCount: 0,
      declinedCount: 0,
    });
  });
});
