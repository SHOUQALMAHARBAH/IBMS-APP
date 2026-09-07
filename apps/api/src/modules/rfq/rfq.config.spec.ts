import { describe, expect, it } from 'vitest';
import { isFollowUpDue } from './rfq.config';

// 2026-01-01 is a Thursday (UTC day 4). addBusinessDays skips Fri(5)+Sat(6):
//   Thu 01-01 + 1 business day -> Sun 01-04
//   Thu 01-01 + 2 business days -> Mon 01-05
const SENT_THURSDAY = new Date('2026-01-01T09:00:00Z');

describe('isFollowUpDue', () => {
  it('is not due before the threshold has elapsed', () => {
    expect(
      isFollowUpDue(SENT_THURSDAY, 2, new Date('2026-01-02T09:00:00Z')),
    ).toBe(false);
  });

  it('counts the threshold in Jordan business days — the weekend does not count', () => {
    // A plain calendar-day count of 2 would make this "due" on Sat 01-03;
    // business days push it to Mon 01-05, so Sun 01-04 is still not due.
    expect(
      isFollowUpDue(SENT_THURSDAY, 2, new Date('2026-01-04T12:00:00Z')),
    ).toBe(false);
  });

  it('is due exactly on the computed business-day boundary', () => {
    expect(
      isFollowUpDue(SENT_THURSDAY, 2, new Date('2026-01-05T09:00:00Z')),
    ).toBe(true);
  });

  it('is due once the boundary is past', () => {
    expect(
      isFollowUpDue(SENT_THURSDAY, 2, new Date('2026-01-06T09:00:00Z')),
    ).toBe(true);
  });

  it('treats a non-positive or malformed threshold as "never auto-alert"', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    expect(isFollowUpDue(SENT_THURSDAY, 0, now)).toBe(false);
    expect(isFollowUpDue(SENT_THURSDAY, -3, now)).toBe(false);
    expect(isFollowUpDue(SENT_THURSDAY, Number.NaN, now)).toBe(false);
  });
});
