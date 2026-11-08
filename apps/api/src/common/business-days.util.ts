/**
 * Business-day and SLA-duration date math shared by every workflow in
 * ibms-brain/meta/lex/pdpl-sla-timers.md — most of that table's deadlines
 * are stated in "business days," not calendar days, and Jordan's weekend is
 * Friday+Saturday, not the Saturday/Sunday pattern a default date library
 * assumes.
 *
 * A GAZETTED PUBLIC-HOLIDAY CALENDAR NOW EXISTS, and this docblock said
 * otherwise until 2026-11-08 — ten lines above `BusinessDayOptions.holidays`,
 * which said it did. `SlaHoliday` (schema.prisma, `model SlaHoliday`) is
 * HTTP-editable through `sla-timer.controller.ts` and holds 48 rows on dev.
 * The sentence that used to sit here — "treat a computed business-day deadline
 * as a lower bound until a public-holiday calendar is supplied" — was an
 * absence claim that was true when written and rotted in place, and it was the
 * first thing a reader of this file met.
 *
 * THIS UTIL IS PURE AND DOES NO I/O, SO THE CALLER MUST PASS THE CALENDAR.
 * A caller that passes none still gets the weekend-only lower bound; that is
 * not a default, it is an omission, and it is invisible at the call site
 * because `BusinessDayOptions` is optional.
 *
 * Measured 2026-11-08 — 12 non-spec files import this module, 9 of them
 * evaluate a duration, and the holidays reach exactly ONE evaluation path:
 * `sla-status.config.ts` builds the set (`holidaySet`, `businessDayOptionsFor`)
 * and `sla-timer.service.ts:234` fetches it and hands it to
 * `computePolicyDueAt` — the CONFIGURED-POLICY path.
 *
 * SEVEN call sites in SIX files compute in `businessDays` and pass no
 * holidays: `follow-up.util.ts:55`, `dsr.config.ts:95`,
 * `access-recertification.controller.ts:75`,
 * `access-recertification.scheduler.ts:40`, and three in
 * `sla-timer.service.ts` itself — `:181` the registry fallback, `:227` the
 * regulatory fast track, `:277` the one non-zero escalation offset. Those
 * deadlines are weekend-only lower bounds. Re-derive the importer list with
 * `grep -rl "business-days.util" --include=*.ts apps/api/src | grep -v spec`.
 *
 * A caller whose unit is `calendarDays`, `months`, or `minutes`/`hours` with
 * no `workingWindow` is NOT in that set — those units never consult
 * `businessDayOptions`, so there is nothing for them to pass.
 */

/** Friday (5) and Saturday (6) — `Date#getUTCDay()` numbering. */
export const JORDAN_WEEKEND_DAYS: readonly number[] = [5, 6];

export interface BusinessDayOptions {
  weekendDays?: readonly number[];
  /** Non-working dates, as `YYYY-MM-DD` strings in UTC. Supplied by the caller
   * from `SlaHoliday` rows — this util stays pure and does no I/O.
   *
   * Until SLA policies existed this file accounted for the WEEKEND ONLY, and
   * said so: "treat a computed business-day deadline as a lower bound rather
   * than an exact one until a public-holiday calendar is supplied." A holiday
   * calendar now exists, so a caller that passes one gets an exact deadline
   * instead of a lower bound. A caller that passes none behaves exactly as
   * before. */
  holidays?: ReadonlySet<string>;
}

/** `YYYY-MM-DD` in UTC — the key `BusinessDayOptions.holidays` is keyed on. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isBusinessDay(
  date: Date,
  options?: BusinessDayOptions,
): boolean {
  const weekend = new Set(options?.weekendDays ?? JORDAN_WEEKEND_DAYS);
  if (weekend.has(date.getUTCDay())) return false;
  return !(options?.holidays?.has(utcDateKey(date)) ?? false);
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
  const direction = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  const result = new Date(start.getTime());
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    if (isBusinessDay(result, options)) {
      remaining -= 1;
    }
  }
  return result;
}

export type SlaDurationUnit =
  'minutes' | 'hours' | 'calendarDays' | 'businessDays' | 'months';

/** A signed SLA duration or escalation offset. Negative `value` means
 * "before the reference date" — used for a pre-deadline early-warning
 * escalation stage (e.g. DSR's T-3-business-days DPO alert). */
export interface SlaDuration {
  value: number;
  unit: SlaDurationUnit;
  /** Applies to `'businessDays'`, and to `'minutes'`/`'hours'` when a
   * `workingWindow` is set (working time only accrues on business days). */
  businessDayOptions?: BusinessDayOptions;
  /** When set, a MINUTES/HOURS duration counts WORKING time only — time
   * inside this window, on business days. Absent, those units are plain
   * elapsed time, which is right for a round-the-clock clock such as breach
   * containment. */
  workingWindow?: WorkingWindow;
}

/**
 * A working-hours window, e.g. 08:00-16:00, expressed in whole minutes from
 * midnight in the policy's own timezone.
 */
export interface WorkingWindow {
  startMinute: number;
  endMinute: number;
  /** IANA zone, e.g. "Asia/Amman". The window is a LOCAL clock time — 08:00
   * in Amman is a different instant in January and July, so this cannot be
   * collapsed to a fixed UTC offset. */
  timezone: string;
}

/** "HH:MM" -> minutes from midnight. Returns null for anything unparseable,
 * so a malformed policy degrades to "no window" rather than to a wrong
 * deadline. */
export function parseTimeOfDay(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes from local midnight for `date` in `timezone`, via Intl rather than
 * a hand-rolled offset table — DST and Jordan's own past offset changes are
 * not something to reimplement. */
export function localMinuteOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl renders midnight as "24" in some locales/engines.
  return (hour % 24) * 60 + minute;
}

/**
 * Advances `base` by `minutes` of WORKING time — time inside the window, on
 * business days only.
 *
 * Why this exists: a 4-hour SLA raised at 15:00 on a Thursday with an
 * 08:00-16:00 window is not due at 19:00 Thursday (the office is shut) and not
 * due at 19:00 Sunday either (that is 4 CALENDAR hours later on a working
 * day). It is due at 11:00 Sunday — one working hour on Thursday, three on
 * Sunday. Treating working hours as decoration and adding elapsed time
 * silently sets a deadline nobody could have met.
 *
 * Walks minute-blocks rather than iterating minute by minute, so a long
 * duration costs a handful of steps instead of thousands.
 */
export function addWorkingMinutes(
  base: Date,
  minutes: number,
  window: WorkingWindow,
  options?: BusinessDayOptions,
): Date {
  if (minutes === 0) return new Date(base.getTime());
  if (window.endMinute <= window.startMinute) {
    // A window that does not describe a span cannot be honoured; fall back to
    // elapsed time rather than inventing one.
    return new Date(base.getTime() + minutes * 60_000);
  }

  const dayLength = window.endMinute - window.startMinute;
  let remaining = minutes;
  let cursor = new Date(base.getTime());
  // Bounded so a pathological calendar (every day a holiday) cannot spin
  // forever; ~10 years of days is far past any SLA in this system.
  for (let guard = 0; guard < 4000 && remaining > 0; guard++) {
    if (!isBusinessDay(cursor, options)) {
      cursor = startOfNextWorkingDay(cursor, window);
      continue;
    }
    const nowMinute = localMinuteOfDay(cursor, window.timezone);
    if (nowMinute < window.startMinute) {
      cursor = new Date(
        cursor.getTime() + (window.startMinute - nowMinute) * 60_000,
      );
      continue;
    }
    if (nowMinute >= window.endMinute) {
      cursor = startOfNextWorkingDay(cursor, window);
      continue;
    }
    const availableToday = window.endMinute - nowMinute;
    if (remaining <= availableToday) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= availableToday;
    cursor = startOfNextWorkingDay(cursor, window);
    void dayLength;
  }
  return cursor;
}

/** Midnight-plus-window-start on the following calendar day. The caller's loop
 * skips non-business days, so this only has to move one day at a time. */
function startOfNextWorkingDay(from: Date, window: WorkingWindow): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  const minuteNow = localMinuteOfDay(next, window.timezone);
  return new Date(next.getTime() + (window.startMinute - minuteNow) * 60_000);
}

/** Applies a signed `SlaDuration` to `base`, returning the resulting Date. */
export function applyDuration(base: Date, duration: SlaDuration): Date {
  switch (duration.unit) {
    case 'minutes': {
      if (duration.workingWindow) {
        return addWorkingMinutes(
          base,
          duration.value,
          duration.workingWindow,
          duration.businessDayOptions,
        );
      }
      const result = new Date(base.getTime());
      result.setUTCMinutes(result.getUTCMinutes() + duration.value);
      return result;
    }
    case 'hours': {
      if (duration.workingWindow) {
        return addWorkingMinutes(
          base,
          duration.value * 60,
          duration.workingWindow,
          duration.businessDayOptions,
        );
      }
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
