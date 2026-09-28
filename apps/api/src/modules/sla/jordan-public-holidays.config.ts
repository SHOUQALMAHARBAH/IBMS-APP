/**
 * Jordan's public holidays — the vocabulary, and the line between what may be
 * generated and what must be entered.
 *
 * Source: Jordan's Ministry of Foreign Affairs,
 * https://www.mfa.gov.jo/content/public-holidays (owner-supplied, 2026-09-28).
 *
 * ## THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * **The Islamic dates are NOT computed, and must never be.** In Jordan the actual
 * holiday is set by official announcement and can differ by a day from any calendar
 * conversion. A computed Hijri calendar would be wrong most years and nobody would know
 * why — the deadlines would simply be off, and the error would look like arithmetic
 * rather than a wrong input. So the moving occasions are ENTERED PER YEAR from the
 * announcement, and this file holds only their NAMES and their expected LENGTH, which
 * is what lets a screen say "Eid al-Fitr is not entered for 2027 yet" without inventing
 * a date for it.
 *
 * The fixed four are a different thing: 1 January is 1 January. Generating `2027-01-01`
 * from "New Year's Day, 1 Jan" is not a calendar conversion and carries no risk, so
 * those may be produced for any year on demand.
 */

/** A holiday whose date is the same every year. Safe to generate. */
export interface FixedDateHoliday {
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  nameEn: string;
  nameAr: string;
}

/**
 * The four fixed-date public holidays. Ordered by date, which is the order a calendar
 * reads in.
 */
export const JORDAN_FIXED_HOLIDAYS: readonly FixedDateHoliday[] = [
  { month: 1, day: 1, nameEn: "New Year's Day", nameAr: 'رأس السنة الميلادية' },
  { month: 5, day: 1, nameEn: 'Labour Day', nameAr: 'عيد العمال' },
  { month: 5, day: 25, nameEn: 'Independence Day', nameAr: 'عيد الاستقلال' },
  { month: 12, day: 25, nameEn: 'Christmas', nameAr: 'عيد الميلاد المجيد' },
] as const;

/**
 * An occasion whose date moves with the Hijri calendar and is fixed by announcement.
 *
 * `days` is how many CONSECUTIVE non-working days the occasion covers. It matters for
 * two reasons: an officer entering Eid al-Adha by hand would have to remember it is five
 * days and not four, and a screen cannot report the calendar complete without knowing
 * how many rows an occasion owes.
 */
export interface MovingHoliday {
  key: string;
  nameEn: string;
  nameAr: string;
  days: number;
}

export const JORDAN_MOVING_HOLIDAYS: readonly MovingHoliday[] = [
  {
    key: 'islamic_new_year',
    nameEn: 'Islamic New Year',
    nameAr: 'رأس السنة الهجرية',
    days: 1,
  },
  {
    key: 'prophets_birthday',
    nameEn: "Prophet's Birthday",
    nameAr: 'المولد النبوي الشريف',
    days: 1,
  },
  { key: 'eid_al_fitr', nameEn: 'Eid al-Fitr', nameAr: 'عيد الفطر', days: 4 },
  { key: 'eid_al_adha', nameEn: 'Eid al-Adha', nameAr: 'عيد الأضحى', days: 5 },
] as const;

/** Total non-working days the moving occasions owe in any year: 1 + 1 + 4 + 5. */
export const MOVING_HOLIDAY_DAYS_PER_YEAR = JORDAN_MOVING_HOLIDAYS.reduce(
  (sum, h) => sum + h.days,
  0,
);

/**
 * The fixed four as whole UTC days in `year`.
 *
 * UTC and whole days, matching how a holiday is stored and looked up — a local-time
 * construction would shift the day for half the world, which on a deadline calendar
 * means the holiday lands on the wrong date for some readers.
 */
export function fixedHolidaysForYear(
  year: number,
): { observedOn: Date; nameEn: string; nameAr: string }[] {
  return JORDAN_FIXED_HOLIDAYS.map((h) => ({
    observedOn: new Date(Date.UTC(year, h.month - 1, h.day)),
    nameEn: h.nameEn,
    nameAr: h.nameAr,
  }));
}

/** `YYYY-MM-DD` for a whole UTC day — the spelling the API and the screen share. */
export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * `count` consecutive whole UTC days starting at `start`.
 *
 * Used for an Eid, which is four or five days rather than one. Deliberately a plain day
 * increment and NOT a business-day walk: a public holiday falls on the day it falls on,
 * including a Friday, and skipping the weekend here would move Eid.
 */
export function consecutiveDays(start: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(
      new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate() + i,
        ),
      ),
    );
  }
  return out;
}
