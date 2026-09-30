import { apiGet, apiPost } from '../auth/api-client';

/*
 * THE NON-WORKING-DAY CALENDAR every business-day deadline is counted against.
 *
 * `GET /sla/holidays` and `POST /sla/holidays` had no web caller at all
 * (IMPROVEMENTS § 1.44, § 1.57), and the consequence is a measured one rather
 * than a theoretical gap: the dev database holds **zero** holiday rows, so every
 * `BUSINESS_DAYS` deadline in the system is currently computed as though Fridays
 * were the only non-working days of the year.
 *
 * That error has a direction. A deadline computed without the office's holidays
 * lands EARLIER than the real one, so a breach is reported sooner than it
 * happened and a resolution inside the true window is recorded late. Every
 * figure on the SLA dashboard is therefore a lower bound, and the brokerage's own
 * compliance numbers currently overstate its lateness — against itself.
 *
 * The dates are the office's to supply: which days a Jordanian brokerage
 * observes comes from the official gazette, and inventing a list here would be
 * the "record an internal guess as a legal fact" mistake the SLA source rules
 * exist to prevent. What this closes is the absence of any way to enter them.
 */

export const SLA_CALENDAR_TYPES = [
  'JORDAN_STANDARD',
  'CONTINUOUS_24_7',
  'CUSTOM',
] as const;
export type SlaCalendarType = (typeof SLA_CALENDAR_TYPES)[number];

export interface SlaHoliday {
  id: string;
  /** An ISO timestamp for the whole UTC day — the API stores a DATE. */
  observedOn: string;
  name: string;
  /** `null` = applies to every calendar, which is the ordinary case for a
   * national holiday. */
  calendarType: SlaCalendarType | null;
  createdByUserId: string | null;
  createdAt: string;
}

export function listSlaHolidays(): Promise<SlaHoliday[]> {
  return apiGet('/sla/holidays');
}

/** `observedOn` is `YYYY-MM-DD`, never a timestamp: a holiday is a DAY, and
 * sending an instant shifts it by one for half the world. The API parses it as
 * a whole UTC day for the same reason. */
export function createSlaHoliday(input: {
  observedOn: string;
  name: string;
  calendarType?: SlaCalendarType;
}): Promise<SlaHoliday> {
  return apiPost('/sla/holidays', {
    observedOn: input.observedOn,
    name: input.name.trim(),
    ...(input.calendarType ? { calendarType: input.calendarType } : {}),
  });
}

/** The DTO's own floor, mirrored so the button disables instead of the server
 * refusing after a round trip. */
export const HOLIDAY_NAME_MIN_LENGTH = 2;

export function holidayNameIsValid(name: string): boolean {
  return name.trim().length >= HOLIDAY_NAME_MIN_LENGTH;
}

/** `YYYY-MM-DD`, the shape both the `<input type="date">` and the DTO use. */
export function holidayDateIsValid(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

/*
 * ONE YEAR AT A TIME, AND WHAT THE YEAR STILL OWES.
 *
 * Jordan's public holidays split in two (Ministry of Foreign Affairs,
 * https://www.mfa.gov.jo/content/public-holidays):
 *
 *   FIXED    1 Jan · 1 May · 25 May · 25 Dec — may be generated, and are seeded
 *   MOVING   Islamic New Year · Prophet's Birthday · Eid al-Fitr (4d) · Eid al-Adha (5d)
 *
 * **The moving dates are never computed.** In Jordan the actual holiday is set by
 * official announcement and can differ by a day from any calendar conversion — a
 * computed Hijri calendar would be wrong most years and nobody would know why, because
 * the deadlines would just be off and the error would look like arithmetic rather than a
 * wrong input. They are entered per year from the announcement, and `missingOccasions`
 * is how the screen tells an office which ones it has not entered yet.
 */

export interface HolidayYearView {
  year: number;
  holidays: SlaHoliday[];
  /** Fixed dates not yet present in this year — fillable in one action. */
  missingFixed: { nameEn: string; nameAr: string; observedOn: string }[];
  /** Occasions with no row naming them in this year. `days` is how many consecutive
   * non-working days the occasion covers, which is why it cannot be entered as one. */
  missingOccasions: { key: string; nameEn: string; nameAr: string; days: number }[];
}

export function getHolidayYear(year: number): Promise<HolidayYearView> {
  return apiGet(`/sla/holidays/year/${year}`);
}

/** Creates only the fixed dates the year is missing. Idempotent server-side: two people
 * opening the same year must not give the second one a duplicate-date conflict. */
export function addFixedHolidaysForYear(
  year: number,
): Promise<{ created: SlaHoliday[]; skipped: number }> {
  return apiPost(`/sla/holidays/year/${year}/fixed`, {});
}

/** Enters a moving occasion from the year's announcement. Only the START date is sent —
 * the server supplies the length from the occasion, so a five-day Eid cannot be entered
 * as four by a caller that forgot. */
export function addMovingOccasion(
  occasionKey: string,
  startDate: string,
): Promise<SlaHoliday[]> {
  return apiPost('/sla/holidays/occasion', { occasionKey, startDate });
}
