/**
 * Shared "what UTC calendar month are we scoring" helper for a monthly
 * periodic job. Originally local to `insurer-performance.config.ts`
 * (Process 60); promoted here once `employee-performance.config.ts`
 * (Process 61) needed the identical calculation — the `calendar-date.util.ts`
 * promotion precedent (`policy.config.ts` re-exports that one so existing
 * imports keep working unchanged; `insurer-performance.config.ts` does the
 * same here).
 */

export interface PeriodWindow {
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
}

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
