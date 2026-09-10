import type { SlaDurationUnit as PrismaSlaDurationUnit } from '@ibms/db';
import type {
  BusinessDayOptions,
  SlaDuration,
  SlaDurationUnit,
} from '../../common/business-days.util';
import {
  applyDuration,
  parseTimeOfDay,
  utcDateKey,
  type WorkingWindow,
} from '../../common/business-days.util';

/**
 * The lifecycle of one SLA instance, and the pure math behind it.
 *
 * Kept separate from `SlaTimerService` so the arithmetic — which is the part
 * that can be silently wrong — is testable without a database, a clock, or a
 * Nest module.
 */
export type SlaStatus =
  | 'NOT_STARTED'
  | 'ON_TRACK'
  | 'APPROACHING_DUE'
  | 'BREACHED'
  | 'COMPLETED_WITHIN_SLA'
  | 'COMPLETED_AFTER_SLA'
  | 'PAUSED';

/** Maps the DB enum onto the util's own unit vocabulary. Two spellings exist
 * because the util predates the table and is used by callers that never touch
 * a policy row. */
const UNIT_BY_PRISMA: Readonly<Record<PrismaSlaDurationUnit, SlaDurationUnit>> =
  {
    MINUTES: 'minutes',
    HOURS: 'hours',
    BUSINESS_DAYS: 'businessDays',
    CALENDAR_DAYS: 'calendarDays',
    MONTHS: 'months',
  };

export function toSlaDuration(
  value: number,
  unit: PrismaSlaDurationUnit,
  businessDayOptions?: BusinessDayOptions,
  workingWindow?: WorkingWindow,
): SlaDuration {
  return {
    value,
    unit: UNIT_BY_PRISMA[unit],
    businessDayOptions,
    workingWindow,
  };
}

/**
 * The policy's working-hours window, or `undefined` when it does not define
 * one (in which case MINUTES/HOURS are plain elapsed time — right for a
 * round-the-clock clock like breach containment).
 *
 * A CONTINUOUS_24_7 policy never has a window even if the columns are filled:
 * "runs around the clock" and "only during office hours" are contradictory,
 * and the calendar is the more explicit statement of intent.
 */
export function workingWindowFor(policy: {
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  timezone: string;
  calendarType: 'JORDAN_STANDARD' | 'CONTINUOUS_24_7' | 'CUSTOM';
}): WorkingWindow | undefined {
  if (policy.calendarType === 'CONTINUOUS_24_7') return undefined;
  const startMinute = parseTimeOfDay(policy.workingHoursStart);
  const endMinute = parseTimeOfDay(policy.workingHoursEnd);
  if (startMinute === null || endMinute === null) return undefined;
  if (endMinute <= startMinute) return undefined;
  return { startMinute, endMinute, timezone: policy.timezone };
}

/** Turns `SlaHoliday` rows into the set `business-days.util` expects. */
export function holidaySet(
  holidays: readonly { observedOn: Date }[],
): ReadonlySet<string> {
  return new Set(holidays.map((h) => utcDateKey(h.observedOn)));
}

export interface SlaTimerState {
  dueAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
  pausedAt: Date | null;
  pausedTotalMs: number;
  breachedAt: Date | null;
}

/**
 * The deadline ADJUSTED for time the clock spent paused.
 *
 * `dueAt` is never mutated by a pause — a regulator asking "when was this
 * originally due?" and "how long did you actually have?" are different
 * questions, and both stay answerable. Everything downstream (status,
 * remaining time, breach detection) compares against this, not raw `dueAt`.
 */
export function effectiveDueAt(timer: SlaTimerState, now: Date): Date {
  const pausedSoFar =
    timer.pausedTotalMs +
    (timer.pausedAt
      ? Math.max(0, now.getTime() - timer.pausedAt.getTime())
      : 0);
  return new Date(timer.dueAt.getTime() + pausedSoFar);
}

/** Milliseconds left before the adjusted deadline. Negative once overdue.
 * `null` while paused — a paused clock has no meaningful countdown, and
 * returning a number that silently stops changing invites misreading. */
export function remainingMs(timer: SlaTimerState, now: Date): number | null {
  if (timer.pausedAt) return null;
  return effectiveDueAt(timer, now).getTime() - now.getTime();
}

/**
 * Where this timer stands.
 *
 * `warningThreshold` is the FRACTION of the window elapsed at which the status
 * becomes APPROACHING_DUE (0.8 = at 80%), taken from the policy rather than
 * hard-coded, because "approaching" means something different for a 1-hour
 * containment clock and a 30-day DSR.
 */
export function slaStatus(
  timer: SlaTimerState,
  now: Date,
  warningThreshold = 0.8,
): SlaStatus {
  const adjustedDue = effectiveDueAt(timer, now);

  if (timer.resolvedAt) {
    // Completed. Which side of the line it landed on is the whole point of
    // recording it — "completed" alone hides a breach.
    const dueAtCompletion = new Date(
      timer.dueAt.getTime() + timer.pausedTotalMs,
    );
    return timer.resolvedAt.getTime() <= dueAtCompletion.getTime()
      ? 'COMPLETED_WITHIN_SLA'
      : 'COMPLETED_AFTER_SLA';
  }

  if (timer.pausedAt) return 'PAUSED';
  if (timer.breachedAt || now.getTime() > adjustedDue.getTime()) {
    return 'BREACHED';
  }

  const total = adjustedDue.getTime() - timer.createdAt.getTime();
  if (total <= 0) return 'ON_TRACK';
  const elapsed = now.getTime() - timer.createdAt.getTime();
  return elapsed / total >= warningThreshold ? 'APPROACHING_DUE' : 'ON_TRACK';
}

/** Due date for a policy applied to `startedAt`. Pure — the caller supplies
 * the calendar, so this never reaches for a database or a clock. */
export function computePolicyDueAt(
  policy: {
    durationValue: number;
    durationUnit: PrismaSlaDurationUnit;
    calendarType: 'JORDAN_STANDARD' | 'CONTINUOUS_24_7' | 'CUSTOM';
    customWeekendDays: number[];
    workingHoursStart?: string | null;
    workingHoursEnd?: string | null;
    timezone?: string;
  },
  startedAt: Date,
  holidays: ReadonlySet<string>,
): Date {
  return applyDuration(
    startedAt,
    toSlaDuration(
      policy.durationValue,
      policy.durationUnit,
      businessDayOptionsFor(policy, holidays),
      workingWindowFor({
        workingHoursStart: policy.workingHoursStart ?? null,
        workingHoursEnd: policy.workingHoursEnd ?? null,
        timezone: policy.timezone ?? 'Asia/Amman',
        calendarType: policy.calendarType,
      }),
    ),
  );
}

/** The working calendar a policy walks. `CONTINUOUS_24_7` deliberately has NO
 * weekend and NO holidays — a containment clock does not stop for Friday. */
export function businessDayOptionsFor(
  policy: {
    calendarType: 'JORDAN_STANDARD' | 'CONTINUOUS_24_7' | 'CUSTOM';
    customWeekendDays: number[];
  },
  holidays: ReadonlySet<string>,
): BusinessDayOptions {
  switch (policy.calendarType) {
    case 'CONTINUOUS_24_7':
      return { weekendDays: [], holidays: new Set<string>() };
    case 'CUSTOM':
      return { weekendDays: policy.customWeekendDays, holidays };
    case 'JORDAN_STANDARD':
    default:
      return { holidays };
  }
}
