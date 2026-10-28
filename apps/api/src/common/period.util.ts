/**
 * Shared "what UTC calendar month are we scoring" helper for a monthly
 * periodic job. Originally local to `insurer-performance.config.ts`
 * (Process 60); promoted here once `employee-performance.config.ts`
 * (Process 61) needed the identical calculation — the `calendar-date.util.ts`
 * promotion precedent (`policy.config.ts` re-exports that one so existing
 * imports keep working unchanged; `insurer-performance.config.ts` does the
 * same here).
 */

/**
 * WHAT A FIGURE'S PERIOD ACTUALLY MEANS — owner decision 58.
 *
 * `'period'`: the figure counts events inside `[periodStart, periodEnd)`, so the
 * period belongs beside it and a bare number is the defect she reported.
 * `'asOf'`: the figure is a LIVE SNAPSHOT and ignores the period filter entirely —
 * `/dashboards/policy`'s active and expiring counts read `Policy.status` and
 * `Policy.expiryDate` as of now whatever period is chosen, which that config calls
 * «a deliberate asymmetry, not an oversight».
 *
 * IT IS SHIPPED ON THE VIEW RATHER THAN KNOWN BY THE SCREEN. The api is the only
 * thing that knows which of its own queries obey the window; a screen carrying its
 * own copy of that classification is a copy free to stop matching, and the failure
 * then LOOKS like the fix — a figure labelled with a period it does not obey, which
 * is a more confident version of the defect decision 58 exists to remove.
 */
export type FigureScope = 'period' | 'asOf';

export interface PeriodWindow {
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * THESE TWO ARE NOT INTERCHANGEABLE AND THE DIFFERENCE IS A DECISION.
 *
 * `previousUtcMonthRange` is for a SCORING JOB: a month is scored once it has
 * fully elapsed, so a performance figure never describes a month still running.
 * `currentUtcMonthRange` is for A READER'S DEFAULT: somebody opening a dashboard
 * today is asking about today, and owner decision 58 is what established that —
 * «قسم العملاء المحتملون بيطلع 0 مع إنه في عملاء محتملون جدد»: measured, 120 leads,
 * every one created in October, against a default window of September, which held
 * zero. The screen was telling the truth about a month she was not asking about.
 *
 * CALLERS ARE TOLD APART BY THEIR DTO, which is why neither function needs a flag:
 * a `…QueryDto` is a reader (`resolvePeriod`) and a `Compute…Dto` is a job
 * (`resolvePeriodFromDto`). `period-default.inventory.spec.ts` pins both halves by
 * name, so pointing a scheduler at the current month fails there rather than
 * silently writing a score for an unfinished month.
 */

/** Pure: `[periodStart, periodEnd)` + a "YYYY-MM" label for the UTC calendar
 * month immediately before the one containing `now` — a monthly job scores
 * a month only once it has fully elapsed. */
export function previousUtcMonthRange(now: Date): PeriodWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; "this" month
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const periodLabel = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { periodLabel, periodStart, periodEnd };
}

/** Pure: `[periodStart, periodEnd)` + a "YYYY-MM" label for the UTC calendar month
 * CONTAINING `now` — a reader's default (owner decision 58). The window still ends at
 * the first instant of next month rather than at `now`, so it is the same half-open
 * shape every period filter in this codebase already takes and no caller needs to
 * special-case a partial month: a figure for a month in progress is simply smaller
 * than it will be, which is what the period printed beside it says.
 *
 * NOT for a scoring job — see the note above `previousUtcMonthRange`. */
export function currentUtcMonthRange(now: Date): PeriodWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based; the month containing `now`
  const periodStart = new Date(Date.UTC(year, month, 1));
  const periodEnd = new Date(Date.UTC(year, month + 1, 1));
  const periodLabel = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { periodLabel, periodStart, periodEnd };
}
