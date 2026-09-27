import { describe, expect, it } from 'vitest';
import { isCalendarDate } from './is-calendar-date.validator';

/*
 * A DATE THAT EXISTS, versus a string shaped like one.
 *
 * This exists because CI caught a 500 on `POST /sla/holidays` from a date my own
 * test generated — `2032-04-0${Math.floor(Math.random() * 9)}` can produce day
 * `00` — and chasing that found the real defect underneath: `@Matches` on the
 * YYYY-MM-DD shape is the established spelling across this api, and it accepts
 * three kinds of non-date. The middle one is the dangerous one.
 */
describe('isCalendarDate', () => {
  it('accepts a real day', () => {
    expect(isCalendarDate('2026-05-25')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true); // a real leap day
  });

  it('REFUSES 30 February, which `new Date` silently rolls into March', () => {
    // THE ONE THAT MATTERS. A 500 is loud and gets reported; this one records a
    // fact nobody typed. On the holiday calendar it means a non-working day
    // stored on 2 March because an administrator typed 30 February, and every
    // business-day deadline in the office then counts against the wrong day.
    expect(
      new Date('2026-02-30T00:00:00.000Z').toISOString().slice(0, 10),
    ).toBe('2026-03-02');
    expect(isCalendarDate('2026-02-30')).toBe(false);
  });

  it('refuses 29 February in a non-leap year', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });

  it('refuses a day of 00 — the value that made CI red', () => {
    expect(isCalendarDate('2032-04-00')).toBe(false);
  });

  it('refuses a month of 13 and a month of 00', () => {
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-00-01')).toBe(false);
  });

  it('refuses a 32nd day and a 31st of a 30-day month', () => {
    expect(isCalendarDate('2026-01-32')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
  });

  it('refuses anything that is not the whole-day SHAPE', () => {
    // The shape check stays in `@Matches` so the two failures read differently,
    // but this function must not accept them either — it is used directly by the
    // service-level guard as well as through the decorator.
    expect(isCalendarDate('2026-5-25')).toBe(false);
    expect(isCalendarDate('2026-05-25T00:00:00.000Z')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate('not a date')).toBe(false);
  });

  it('refuses a non-string', () => {
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
    expect(isCalendarDate(20260525)).toBe(false);
    expect(isCalendarDate(new Date())).toBe(false);
  });
});
