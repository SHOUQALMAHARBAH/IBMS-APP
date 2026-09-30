import { describe, expect, it } from 'vitest';
import {
  consecutiveDays,
  fixedHolidaysForYear,
  JORDAN_FIXED_HOLIDAYS,
  JORDAN_MOVING_HOLIDAYS,
  MOVING_HOLIDAY_DAYS_PER_YEAR,
  utcDayKey,
} from './jordan-public-holidays.config';

/*
 * The vocabulary, and the line between generated and entered.
 *
 * Source: Jordan's Ministry of Foreign Affairs,
 * https://www.mfa.gov.jo/content/public-holidays.
 */
describe('Jordan public holidays', () => {
  it('has exactly the four fixed-date holidays, on their gazetted dates', () => {
    expect(
      JORDAN_FIXED_HOLIDAYS.map((h) => `${h.month}-${h.day} ${h.nameEn}`),
    ).toEqual([
      "1-1 New Year's Day",
      '5-1 Labour Day',
      '5-25 Independence Day',
      '12-25 Christmas',
    ]);
  });

  it('names every fixed holiday in BOTH languages', () => {
    // Arabic is this platform's primary language and a holiday name reaches the
    // calendar an office reads; an English-only entry would render untranslated.
    for (const h of JORDAN_FIXED_HOLIDAYS) {
      expect(h.nameAr.trim().length).toBeGreaterThan(1);
      expect(h.nameEn.trim().length).toBeGreaterThan(1);
    }
  });

  it('generates the fixed four as whole UTC days for any year', () => {
    expect(
      fixedHolidaysForYear(2027).map((h) => utcDayKey(h.observedOn)),
    ).toEqual(['2027-01-01', '2027-05-01', '2027-05-25', '2027-12-25']);
    // A leap year changes nothing — none of the four is near the end of February.
    expect(
      fixedHolidaysForYear(2028).map((h) => utcDayKey(h.observedOn)),
    ).toEqual(['2028-01-01', '2028-05-01', '2028-05-25', '2028-12-25']);
  });

  it('carries the moving occasions with their LENGTHS and no dates', () => {
    // THE RULE THIS FILE EXISTS FOR. The Islamic dates are set by official
    // announcement in Jordan and can differ by a day from any calendar conversion, so
    // this config must hold no date for them — only what to ask for. A `date` or
    // `month` field appearing here later is the mistake to catch.
    expect(JORDAN_MOVING_HOLIDAYS.map((h) => `${h.nameEn} x${h.days}`)).toEqual(
      [
        'Islamic New Year x1',
        "Prophet's Birthday x1",
        'Eid al-Fitr x4',
        'Eid al-Adha x5',
      ],
    );
    for (const h of JORDAN_MOVING_HOLIDAYS) {
      expect(Object.keys(h).sort()).toEqual([
        'days',
        'key',
        'nameAr',
        'nameEn',
      ]);
    }
  });

  it('owes eleven non-working days a year from the moving occasions', () => {
    // 1 + 1 + 4 + 5. The figure a screen uses to say whether a year is complete.
    expect(MOVING_HOLIDAY_DAYS_PER_YEAR).toBe(11);
  });

  it('expands an Eid into consecutive days, INCLUDING a weekend', () => {
    // A public holiday falls on the day it falls on. Skipping Friday here would move
    // Eid, so this is a plain day increment and deliberately not a business-day walk.
    // 2027-03-11 is a Thursday; the run crosses Friday and Saturday.
    const run = consecutiveDays(new Date('2027-03-11T00:00:00.000Z'), 4);
    expect(run.map(utcDayKey)).toEqual([
      '2027-03-11',
      '2027-03-12',
      '2027-03-13',
      '2027-03-14',
    ]);
    expect(run[1].getUTCDay()).toBe(5); // Friday, and still a holiday row
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(
      consecutiveDays(new Date('2027-12-30T00:00:00.000Z'), 5).map(utcDayKey),
    ).toEqual([
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
      '2028-01-03',
    ]);
  });
});
