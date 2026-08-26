/**
 * Business-day and SLA-duration date math shared by every workflow in
 * ibms-brain/meta/lex/pdpl-sla-timers.md — most of that table's deadlines
 * are stated in "business days," not calendar days, and Jordan's weekend is
 * Friday+Saturday, not the Saturday/Sunday pattern a default date library
 * assumes.
 *
 * No gazetted public-holiday calendar exists in this brain yet (same gap as
 * the retention-period table — see
 * ibms-brain/meta/context/data-retention-and-disposal.md's "not obvious"
 * section): this util accounts for the weekend only. Treat a computed
 * business-day deadline as a lower bound (i.e. never later than the true
 * legal deadline) rather than an exact one until a public-holiday calendar
 * is supplied.
 */

/** Friday (5) and Saturday (6) — `Date#getUTCDay()` numbering. */
export const JORDAN_WEEKEND_DAYS: readonly number[] = [5, 6];

export interface BusinessDayOptions {
  weekendDays?: readonly number[];
}

export function isBusinessDay(
  date: Date,
  options?: BusinessDayOptions,
): boolean {
  const weekend = new Set(options?.weekendDays ?? JORDAN_WEEKEND_DAYS);
  return !weekend.has(date.getUTCDay());
}

/**
 * Adds (or, for a negative `days`, subtracts) business days to `start`,
 * skipping weekend days. `addBusinessDays(start, 0)` returns `start`
 * unchanged regardless of whether `start` itself falls on a weekend day —
 * callers that need "the next business day on or after `start`" should call
 * `addBusinessDays(start, 1)` from the day before instead.
 */
export function addBusinessDays(
  start: Date,
  days: number,
  options?: BusinessDayOptions,
): Date {
  const weekend = new Set(options?.weekendDays ?? JORDAN_WEEKEND_DAYS);
  const direction = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  const result = new Date(start.getTime());
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    if (!weekend.has(result.getUTCDay())) {
      remaining -= 1;
    }
  }
  return result;
}

export type SlaDurationUnit =
  'hours' | 'calendarDays' | 'businessDays' | 'months';

/** A signed SLA duration or escalation offset. Negative `value` means
 * "before the reference date" — used for a pre-deadline early-warning
 * escalation stage (e.g. DSR's T-3-business-days DPO alert). */
export interface SlaDuration {
  value: number;
  unit: SlaDurationUnit;
  /** Only meaningful when `unit` is `'businessDays'`. */
  businessDayOptions?: BusinessDayOptions;
}

/** Applies a signed `SlaDuration` to `base`, returning the resulting Date. */
export function applyDuration(base: Date, duration: SlaDuration): Date {
  switch (duration.unit) {
    case 'hours': {
      const result = new Date(base.getTime());
      result.setUTCHours(result.getUTCHours() + duration.value);
      return result;
    }
    case 'calendarDays': {
      const result = new Date(base.getTime());
      result.setUTCDate(result.getUTCDate() + duration.value);
      return result;
    }
    case 'months': {
      const result = new Date(base.getTime());
      result.setUTCMonth(result.getUTCMonth() + duration.value);
      return result;
    }
    case 'businessDays':
      return addBusinessDays(base, duration.value, duration.businessDayOptions);
  }
}
