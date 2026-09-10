import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addWorkingMinutes,
  applyDuration,
  isBusinessDay,
  parseTimeOfDay,
  utcDateKey,
} from '../../common/business-days.util';
import {
  businessDayOptionsFor,
  computePolicyDueAt,
  effectiveDueAt,
  holidaySet,
  remainingMs,
  slaStatus,
  toSlaDuration,
  workingWindowFor,
} from './sla-status.config';

const JAN = (day: number, hour = 9) =>
  new Date(Date.UTC(2027, 0, day, hour, 0, 0));

function timer(over: Partial<Parameters<typeof slaStatus>[0]> = {}) {
  return {
    dueAt: JAN(10),
    createdAt: JAN(1),
    resolvedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    breachedAt: null,
    ...over,
  };
}

describe('business-day calculation is NOT value * 24h', () => {
  // Jordan's weekend is Friday+Saturday, not Saturday/Sunday. 2027-01-01 is a
  // Friday, so this is the case a default date library gets wrong.
  it('skips the Jordan weekend (Friday + Saturday)', () => {
    expect(isBusinessDay(new Date(Date.UTC(2027, 0, 1)))).toBe(false); // Fri
    expect(isBusinessDay(new Date(Date.UTC(2027, 0, 2)))).toBe(false); // Sat
    expect(isBusinessDay(new Date(Date.UTC(2027, 0, 3)))).toBe(true); // Sun
  });

  it('3 BUSINESS days from a Thursday lands the following Tuesday, not Sunday', () => {
    // Thu 2027-01-07 + 3 business days: Fri/Sat are skipped -> Sun, Mon, Tue.
    const thursday = new Date(Date.UTC(2027, 0, 7));
    const due = addBusinessDays(thursday, 3);
    expect(utcDateKey(due)).toBe('2027-01-12');
    // A naive 3 * 24h would have said the 10th — two days early.
    const naive = new Date(thursday.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(utcDateKey(naive)).toBe('2027-01-10');
    expect(utcDateKey(due)).not.toBe(utcDateKey(naive));
  });

  it('skips configured HOLIDAYS as well as weekends', () => {
    // The gap business-days.util documented: "treat a computed business-day
    // deadline as a lower bound ... until a public-holiday calendar is
    // supplied". Sunday the 10th is now a holiday, so the deadline moves on.
    const holidays = new Set(['2027-01-10']);
    const thursday = new Date(Date.UTC(2027, 0, 7));
    expect(utcDateKey(addBusinessDays(thursday, 3))).toBe('2027-01-12');
    expect(utcDateKey(addBusinessDays(thursday, 3, { holidays }))).toBe(
      '2027-01-13',
    );
  });

  it('supports MINUTES for short-fuse clocks', () => {
    const base = new Date(Date.UTC(2027, 0, 4, 9, 0, 0));
    expect(
      applyDuration(base, { value: 90, unit: 'minutes' }).toISOString(),
    ).toBe('2027-01-04T10:30:00.000Z');
  });
});

describe('the calendar a policy walks', () => {
  it('CONTINUOUS_24_7 does not stop for the weekend — a containment clock must not', () => {
    const options = businessDayOptionsFor(
      { calendarType: 'CONTINUOUS_24_7', customWeekendDays: [] },
      new Set(['2027-01-10']),
    );
    expect(options.weekendDays).toEqual([]);
    expect(options.holidays?.size).toBe(0);
  });

  it('CUSTOM uses the policy’s own weekend', () => {
    const options = businessDayOptionsFor(
      { calendarType: 'CUSTOM', customWeekendDays: [0, 6] },
      new Set(),
    );
    expect(options.weekendDays).toEqual([0, 6]);
  });

  it('computes a due date from the configured policy, holidays included', () => {
    const due = computePolicyDueAt(
      {
        durationValue: 3,
        durationUnit: 'BUSINESS_DAYS',
        calendarType: 'JORDAN_STANDARD',
        customWeekendDays: [],
      },
      new Date(Date.UTC(2027, 0, 7)),
      holidaySet([{ observedOn: new Date(Date.UTC(2027, 0, 10)) }]),
    );
    expect(utcDateKey(due)).toBe('2027-01-13');
  });

  it('a ZERO-duration SLA is due at its own trigger — not an error', () => {
    // `termination_access_revocation` is 0 hours: revoke access immediately.
    const at = new Date(Date.UTC(2027, 0, 7, 11, 0, 0));
    expect(applyDuration(at, toSlaDuration(0, 'HOURS')).toISOString()).toBe(
      at.toISOString(),
    );
  });
});

describe('SLA status', () => {
  it('is ON_TRACK well inside the window and APPROACHING_DUE past the threshold', () => {
    const t = timer(); // 1 Jan -> 10 Jan
    expect(slaStatus(t, JAN(2))).toBe('ON_TRACK');
    expect(slaStatus(t, JAN(9))).toBe('APPROACHING_DUE');
  });

  it('takes the warning threshold from the policy rather than a constant', () => {
    const t = timer();
    // At the halfway point: not "approaching" at 0.8, but is at 0.4.
    expect(slaStatus(t, JAN(5), 0.8)).toBe('ON_TRACK');
    expect(slaStatus(t, JAN(5), 0.4)).toBe('APPROACHING_DUE');
  });

  it('is BREACHED once past due and unresolved', () => {
    expect(slaStatus(timer(), JAN(11))).toBe('BREACHED');
  });

  it('distinguishes completed WITHIN from completed AFTER the SLA', () => {
    expect(slaStatus(timer({ resolvedAt: JAN(9) }), JAN(12))).toBe(
      'COMPLETED_WITHIN_SLA',
    );
    expect(slaStatus(timer({ resolvedAt: JAN(11) }), JAN(12))).toBe(
      'COMPLETED_AFTER_SLA',
    );
  });
});

describe('pause / resume arithmetic', () => {
  it('a paused clock is PAUSED, not breached, even past its raw due date', () => {
    const t = timer({ pausedAt: JAN(5) });
    expect(slaStatus(t, JAN(20))).toBe('PAUSED');
  });

  it('pausing does NOT move dueAt — it moves the EFFECTIVE deadline', () => {
    // Both questions stay answerable: "when was this originally due?" and
    // "how long did you actually have?".
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const t = timer({ pausedTotalMs: twoDaysMs });
    expect(t.dueAt.toISOString()).toBe(JAN(10).toISOString());
    expect(effectiveDueAt(t, JAN(9)).toISOString()).toBe(JAN(12).toISOString());
    // The 11th is past the RAW due date, so a reader comparing against dueAt
    // alone would call this breached. It is not — it is late in an extended
    // window (10 of 11 days elapsed), which is APPROACHING_DUE.
    expect(slaStatus(t, JAN(11))).toBe('APPROACHING_DUE');
    expect(slaStatus(t, JAN(11))).not.toBe('BREACHED');
    // And it does breach once the EXTENDED deadline passes.
    expect(slaStatus(t, JAN(13))).toBe('BREACHED');
  });

  it('accrues time while still paused, not only once resumed', () => {
    const t = timer({ pausedAt: JAN(9) });
    // One day into the pause, the effective deadline has moved a day.
    expect(effectiveDueAt(t, JAN(10)).toISOString()).toBe(
      JAN(11).toISOString(),
    );
  });

  it('reports no countdown while paused rather than a frozen number', () => {
    expect(remainingMs(timer({ pausedAt: JAN(5) }), JAN(9))).toBeNull();
    expect(remainingMs(timer(), JAN(9))).toBeGreaterThan(0);
    expect(remainingMs(timer(), JAN(11))).toBeLessThan(0);
  });
});

describe('working hours — an SLA measured in hours respects the office day', () => {
  // A 4-hour SLA raised at 15:00 Thursday with an 08:00-16:00 window is NOT
  // due at 19:00 Thursday (the office is shut) and NOT at 19:00 Sunday (that
  // is 4 CALENDAR hours later on a working day). It is due at 11:00 Sunday:
  // one working hour on Thursday, three on Sunday. Treating working hours as
  // decoration silently sets a deadline nobody could have met.
  const window = { startMinute: 8 * 60, endMinute: 16 * 60, timezone: 'UTC' };

  it('carries the remainder into the next working day', () => {
    const thursday15 = new Date(Date.UTC(2027, 0, 7, 15, 0, 0));
    const due = addWorkingMinutes(thursday15, 4 * 60, window);
    // Fri/Sat are Jordan's weekend, so the next working day is Sunday.
    expect(due.toISOString()).toBe('2027-01-10T11:00:00.000Z');
  });

  it('finishes the same day when the window can absorb it', () => {
    const sunday9 = new Date(Date.UTC(2027, 0, 10, 9, 0, 0));
    expect(addWorkingMinutes(sunday9, 2 * 60, window).toISOString()).toBe(
      '2027-01-10T11:00:00.000Z',
    );
  });

  it('starts the clock at opening time when raised before the window', () => {
    const sunday6 = new Date(Date.UTC(2027, 0, 10, 6, 0, 0));
    expect(addWorkingMinutes(sunday6, 60, window).toISOString()).toBe(
      '2027-01-10T09:00:00.000Z',
    );
  });

  it('rolls to the next working day when raised after closing', () => {
    const sunday18 = new Date(Date.UTC(2027, 0, 10, 18, 0, 0));
    expect(addWorkingMinutes(sunday18, 60, window).toISOString()).toBe(
      '2027-01-11T09:00:00.000Z',
    );
  });

  it('skips holidays as well as the weekend', () => {
    const thursday15 = new Date(Date.UTC(2027, 0, 7, 15, 0, 0));
    const due = addWorkingMinutes(thursday15, 4 * 60, window, {
      holidays: new Set(['2027-01-10']),
    });
    expect(due.toISOString()).toBe('2027-01-11T11:00:00.000Z');
  });

  it('a policy with NO window keeps plain elapsed time', () => {
    // Right for a round-the-clock clock such as breach containment.
    expect(
      workingWindowFor({
        workingHoursStart: null,
        workingHoursEnd: null,
        timezone: 'Asia/Amman',
        calendarType: 'JORDAN_STANDARD',
      }),
    ).toBeUndefined();
  });

  it('a CONTINUOUS_24_7 policy never gets a window, even if the columns are set', () => {
    // "Runs around the clock" and "office hours only" are contradictory; the
    // calendar is the more explicit statement of intent.
    expect(
      workingWindowFor({
        workingHoursStart: '08:00',
        workingHoursEnd: '16:00',
        timezone: 'Asia/Amman',
        calendarType: 'CONTINUOUS_24_7',
      }),
    ).toBeUndefined();
  });

  it('a malformed or inverted window degrades to no window, never a wrong deadline', () => {
    expect(parseTimeOfDay('25:00')).toBeNull();
    expect(parseTimeOfDay('nonsense')).toBeNull();
    expect(
      workingWindowFor({
        workingHoursStart: '16:00',
        workingHoursEnd: '08:00',
        timezone: 'Asia/Amman',
        calendarType: 'JORDAN_STANDARD',
      }),
    ).toBeUndefined();
  });

  it('computePolicyDueAt applies the window end to end', () => {
    const due = computePolicyDueAt(
      {
        durationValue: 4,
        durationUnit: 'HOURS',
        calendarType: 'JORDAN_STANDARD',
        customWeekendDays: [],
        workingHoursStart: '08:00',
        workingHoursEnd: '16:00',
        timezone: 'UTC',
      },
      new Date(Date.UTC(2027, 0, 7, 15, 0, 0)),
      new Set(),
    );
    expect(due.toISOString()).toBe('2027-01-10T11:00:00.000Z');
  });
});
