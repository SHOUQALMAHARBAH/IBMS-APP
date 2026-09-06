import { describe, expect, it } from 'vitest';
import {
  deriveRetentionScheduleItemView,
  retentionScheduleItemAuditSnapshot,
  type RetentionScheduleItemRow,
} from './retention-schedule.config';

const row = (
  over: Partial<RetentionScheduleItemRow> = {},
): RetentionScheduleItemRow => ({
  id: 'rsi-1',
  recordCategory: 'AuditLogEntry',
  retentionPeriodMonths: 120,
  legalBasis: 'DRAFT',
  confirmedByLegalCounselAt: null,
  ...over,
});

describe('deriveRetentionScheduleItemView', () => {
  it('is not confirmed when confirmedByLegalCounselAt is null', () => {
    const v = deriveRetentionScheduleItemView(row());
    expect(v.isConfirmed).toBe(false);
    expect(v.confirmedByLegalCounselAt).toBeNull();
  });

  it('is confirmed once confirmedByLegalCounselAt is set', () => {
    const v = deriveRetentionScheduleItemView(
      row({ confirmedByLegalCounselAt: new Date('2026-09-14T00:00:00.000Z') }),
    );
    expect(v.isConfirmed).toBe(true);
    expect(v.confirmedByLegalCounselAt).toBe('2026-09-14T00:00:00.000Z');
  });
});

describe('retentionScheduleItemAuditSnapshot', () => {
  it('carries the category and confirmation state, no free-text legalBasis', () => {
    const snap = retentionScheduleItemAuditSnapshot(row());
    expect(snap).toEqual({
      retentionScheduleItemId: 'rsi-1',
      recordCategory: 'AuditLogEntry',
      retentionPeriodMonths: 120,
      isConfirmed: false,
    });
  });
});
