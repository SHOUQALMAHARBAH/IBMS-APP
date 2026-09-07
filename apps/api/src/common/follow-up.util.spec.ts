import { describe, expect, it } from 'vitest';
import { isFollowUpDue } from './follow-up.util';

// Thu 1 Jan 2026 — Jordan weekend is Fri/Sat, so + 2 business days is Mon 5 Jan.
const STARTED_THURSDAY = new Date('2026-01-01T09:00:00.000Z');

describe('isFollowUpDue (shared: RFQ #11/#12 + Claim #27)', () => {
  it('is not due mid-window (Fri/Sat do not count)', () => {
    expect(
      isFollowUpDue(STARTED_THURSDAY, 2, new Date('2026-01-02T09:00:00Z')),
    ).toBe(false);
    expect(
      isFollowUpDue(STARTED_THURSDAY, 2, new Date('2026-01-04T12:00:00Z')),
    ).toBe(false);
  });

  it('is due once the whole business-day window has elapsed', () => {
    expect(
      isFollowUpDue(STARTED_THURSDAY, 2, new Date('2026-01-05T09:00:00Z')),
    ).toBe(true);
    expect(
      isFollowUpDue(STARTED_THURSDAY, 2, new Date('2026-01-06T09:00:00Z')),
    ).toBe(true);
  });

  it('a non-positive / malformed threshold never fires', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    expect(isFollowUpDue(STARTED_THURSDAY, 0, now)).toBe(false);
    expect(isFollowUpDue(STARTED_THURSDAY, -3, now)).toBe(false);
    expect(isFollowUpDue(STARTED_THURSDAY, Number.NaN, now)).toBe(false);
    expect(isFollowUpDue(STARTED_THURSDAY, Number.POSITIVE_INFINITY, now)).toBe(
      false,
    );
  });
});
