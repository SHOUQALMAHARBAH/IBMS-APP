import { CronJob } from 'cron';

/**
 * Part B §19 — when a cron expression next fires.
 *
 * Computed from the SAME expression the scheduler is registered with, never
 * restated as prose. A dashboard that says "every 4 hours" while the scheduler
 * says something else is worse than saying nothing, because it is believed.
 *
 * Returns null rather than throwing on an unparseable expression: a broken
 * schedule constant should show as "unknown" on an operations screen, not take
 * the whole screen down.
 */
export function nextCronRun(expression: string): string | null {
  try {
    const job = new CronJob(expression, () => {});
    return job.nextDate().toJSDate().toISOString();
  } catch {
    return null;
  }
}
