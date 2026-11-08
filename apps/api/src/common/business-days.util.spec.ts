import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  applyDuration,
  isBusinessDay,
  JORDAN_WEEKEND_DAYS,
  utcDateKey,
} from './business-days.util';

describe('JORDAN_WEEKEND_DAYS', () => {
  it('is Friday and Saturday, not Saturday/Sunday', () => {
    expect(JORDAN_WEEKEND_DAYS).toEqual([5, 6]);
  });
});

describe('isBusinessDay', () => {
  it('treats Friday and Saturday as non-business days', () => {
    const friday = new Date('2026-08-28T00:00:00.000Z'); // a Friday
    const saturday = new Date('2026-08-29T00:00:00.000Z');
    const sunday = new Date('2026-08-30T00:00:00.000Z');
    expect(isBusinessDay(friday)).toBe(false);
    expect(isBusinessDay(saturday)).toBe(false);
    expect(isBusinessDay(sunday)).toBe(true);
  });

  it('honors a custom weekend', () => {
    const saturday = new Date('2026-08-29T00:00:00.000Z');
    expect(isBusinessDay(saturday, { weekendDays: [0, 6] })).toBe(false);
    expect(isBusinessDay(saturday, { weekendDays: [0, 1] })).toBe(true);
  });
});

describe('addBusinessDays', () => {
  it('returns the same instant for an offset of 0', () => {
    const start = new Date('2026-08-26T12:00:00.000Z'); // a Wednesday
    expect(addBusinessDays(start, 0)).toEqual(start);
  });

  it('skips the Friday/Saturday weekend going forward', () => {
    // Wednesday 2026-08-26 + 3 business days: Thu, then skip Fri/Sat, Sun, Mon
    const start = new Date('2026-08-26T00:00:00.000Z');
    const result = addBusinessDays(start, 3);
    expect(result.toISOString()).toBe('2026-08-31T00:00:00.000Z'); // Monday
  });

  it('skips the weekend going backward for a negative offset', () => {
    // Monday 2026-08-31 - 3 business days: Sun, skip Sat/Fri, Thu, Wed
    const start = new Date('2026-08-31T00:00:00.000Z');
    const result = addBusinessDays(start, -3);
    expect(result.toISOString()).toBe('2026-08-26T00:00:00.000Z'); // Wednesday
  });
});

describe('applyDuration', () => {
  const base = new Date('2026-08-26T09:00:00.000Z');

  it('applies an hours duration', () => {
    expect(applyDuration(base, { value: 4, unit: 'hours' }).toISOString()).toBe(
      '2026-08-26T13:00:00.000Z',
    );
  });

  it('applies a negative hours duration', () => {
    expect(
      applyDuration(base, { value: -1, unit: 'hours' }).toISOString(),
    ).toBe('2026-08-26T08:00:00.000Z');
  });

  it('applies a calendarDays duration', () => {
    expect(
      applyDuration(base, { value: 30, unit: 'calendarDays' }).toISOString(),
    ).toBe('2026-09-25T09:00:00.000Z');
  });

  it('applies a months duration', () => {
    expect(
      applyDuration(base, { value: 6, unit: 'months' }).toISOString(),
    ).toBe('2027-02-26T09:00:00.000Z');
  });

  it('applies a businessDays duration, skipping weekends', () => {
    const wednesday = new Date('2026-08-26T00:00:00.000Z');
    expect(
      applyDuration(wednesday, {
        value: 3,
        unit: 'businessDays',
      }).toISOString(),
    ).toBe('2026-08-31T00:00:00.000Z');
  });
});

/**
 * THE HOLIDAY CALENDAR — untested until 2026-11-08, which is why the gap was
 * invisible.
 *
 * `BusinessDayOptions.holidays` has shipped for as long as `SlaHoliday` has
 * existed, and NOTHING anywhere asserted it did anything: a `grep -c holidays`
 * over this file returned 0. So "remove the holidays argument and a test must
 * fail" was not satisfiable for any caller — the argument could have been a
 * no-op in the util itself and every suite would still have passed.
 *
 * The last test below is the plant in permanent form: it asserts the SAME
 * computation differs with and without the calendar. Make `holidays` a no-op
 * and that test fails, which is the property a caller's wiring can then rest
 * on.
 */
describe('BusinessDayOptions.holidays', () => {
  // 2026-08-30 is a Sunday — a working day in Jordan (weekend is Fri/Sat), so
  // using it as the holiday proves the holiday set is read rather than the
  // weekend rule being hit twice.
  const sundayKey = '2026-08-30';
  const holidays = new Set([sundayKey]);

  it('keys a date the way the option expects', () => {
    expect(utcDateKey(new Date('2026-08-30T23:59:59.000Z'))).toBe(sundayKey);
  });

  it('makes a working day a non-business day', () => {
    const sunday = new Date(`${sundayKey}T00:00:00.000Z`);
    expect(isBusinessDay(sunday)).toBe(true);
    expect(isBusinessDay(sunday, { holidays })).toBe(false);
  });

  it('does not double-count a holiday that falls on the weekend', () => {
    // 2026-08-28 is a Friday — already skipped as weekend. Naming it a holiday
    // must not consume a second day.
    const wednesday = new Date('2026-08-26T00:00:00.000Z');
    expect(
      addBusinessDays(wednesday, 3, {
        holidays: new Set(['2026-08-28']),
      }).toISOString(),
    ).toBe('2026-08-31T00:00:00.000Z');
  });

  it('is honoured through applyDuration, not only addBusinessDays', () => {
    const wednesday = new Date('2026-08-26T00:00:00.000Z');
    expect(
      applyDuration(wednesday, {
        value: 3,
        unit: 'businessDays',
        businessDayOptions: { holidays },
      }).toISOString(),
    ).toBe('2026-09-01T00:00:00.000Z');
  });

  it('CHANGES THE ANSWER — a dropped calendar is observable', () => {
    const wednesday = new Date('2026-08-26T00:00:00.000Z');
    const withoutCalendar = addBusinessDays(wednesday, 3);
    const withCalendar = addBusinessDays(wednesday, 3, { holidays });
    expect(withoutCalendar.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(withCalendar.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(withCalendar.getTime()).toBeGreaterThan(withoutCalendar.getTime());
  });
});
