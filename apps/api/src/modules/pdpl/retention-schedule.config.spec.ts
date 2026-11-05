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
  // The MAKER. Explicit for the same reason as the fields below, and null by default because the
  // four pre-existing rows carry no actor — which is a confirmable state, not a self-confirmation.
  setByUserId: null,
  confirmedByLegalCounselAt: null,
  // Explicit, not omitted: under a `Partial<T>` spread an omitted field becomes `| undefined`,
  // which is what the compiler complains about rather than the omission itself.
  combinedDutyAct: null,
  // Batch 5 group 6 — the no-floor declaration, all five explicit for the same reason.
  noFloorNoticeShown: null,
  noFloorReason: null,
  noFloorAcknowledgedAt: null,
  noFloorAcknowledgedByUserId: null,
  noFloorAcknowledgedMonths: null,
  ...over,
});

describe('deriveRetentionScheduleItemView', () => {
  it('is not confirmed when confirmedByLegalCounselAt is null', () => {
    const v = deriveRetentionScheduleItemView(row());
    expect(v.isConfirmed).toBe(false);
    expect(v.confirmedByLegalCounselAt).toBeNull();
  });

  /**
   * THE MAKER HAS TO REACH THE SCREEN, and it did not.
   *
   * `confirm` resolves the sixteenth maker/checker pair against `setByUserId`, so a one-person
   * office that has declared COMBINED owes a reason — and the screen is what has to collect it,
   * before the request. With the field unprojected the screen had no way to know, sent `{}`, and
   * the engine refused with 422 forever: the category never left draft and the expired-periods
   * view stayed permanently empty.
   *
   * Both directions, because null is the half that is easy to get wrong: an unattributed row is
   * CONFIRMABLE BY ANYBODY (ids are compared, so a null maker can never equal the checker), and
   * reading null as "no maker, so refuse" would make the four pre-existing rows permanently
   * unconfirmable.
   */
  it('projects setByUserId, which is what lets the screen decide a combined duty is owed', () => {
    expect(
      deriveRetentionScheduleItemView(row({ setByUserId: 'user-7' }))
        .setByUserId,
    ).toBe('user-7');
    expect(deriveRetentionScheduleItemView(row()).setByUserId).toBeNull();
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
