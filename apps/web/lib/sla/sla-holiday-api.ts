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
