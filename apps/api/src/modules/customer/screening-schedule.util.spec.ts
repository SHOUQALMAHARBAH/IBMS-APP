import { describe, expect, it } from 'vitest';
import { nextCronRun } from './screening-schedule.util';

/*
 * WHEN A CRON EXPRESSION NEXT FIRES — the fourth of the four `*.util.ts` files in `apps/api/src` that
 * had no sibling spec (measured 2026-11-05).
 *
 * ## What this function is for, and what it must never do
 *
 * An operations screen tells somebody when customers will next be re-screened. The whole design point
 * is in the function's own comment: the answer is COMPUTED from the same expression the scheduler is
 * registered with, never restated as prose, "because a dashboard that says 'every 4 hours' while the
 * scheduler says something else is worse than saying nothing — it is believed".
 *
 * And it must not take the screen down. An unparseable expression returns `null` so the field reads as
 * unknown; throwing would mean a typo in a schedule constant blanks a compliance screen.
 *
 * ## Why the assertions are shaped the way they are
 *
 * The exact instant cannot be asserted — `nextDate()` is relative to now, and this repository's own
 * rule from the `DateEcho` episode is to read the constant rather than reason from an assumed clock.
 * So what is pinned is the PROPERTIES a caller depends on: it is in the future, it is a parseable ISO
 * 8601 instant in UTC, and a malformed expression is `null` rather than an exception.
 */

describe('nextCronRun', () => {
  it('returns an ISO 8601 UTC instant for a valid expression', () => {
    const next = nextCronRun('0 0 */4 * * *');
    expect(next).not.toBeNull();
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns an instant in the future, which is the only claim a screen makes about it', () => {
    const next = nextCronRun('0 0 */4 * * *');
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it('round-trips through Date, so a caller can format it', () => {
    const next = nextCronRun('0 30 2 * * *');
    expect(Number.isNaN(new Date(next!).getTime())).toBe(false);
    expect(new Date(next!).toISOString()).toBe(next);
  });

  /*
   * DIFFERENT EXPRESSIONS MUST GIVE DIFFERENT ANSWERS. Without this, a function that ignored its
   * argument and returned a fixed instant would satisfy every test above — and it would be exactly
   * the "dashboard that says something the scheduler does not" failure this helper exists to prevent.
   */
  it('actually reads the expression it is given', () => {
    const everyMinute = nextCronRun('0 * * * * *');
    const onceAYear = nextCronRun('0 0 0 1 1 *');
    expect(everyMinute).not.toBeNull();
    expect(onceAYear).not.toBeNull();
    expect(new Date(onceAYear!).getTime()).toBeGreaterThan(
      new Date(everyMinute!).getTime(),
    );
  });

  it.each([
    ['empty', ''],
    ['prose rather than an expression', 'every 4 hours'],
    ['too few fields', '*'],
    ['an out-of-range minute', '0 61 * * * *'],
    ['an out-of-range month', '0 0 0 1 13 *'],
    ['punctuation only', '???'],
  ])('returns null for %s rather than throwing', (_label, expression) => {
    let result: string | null | undefined;
    expect(() => {
      result = nextCronRun(expression);
    }).not.toThrow();
    expect(result).toBeNull();
  });

  /*
   * THE NEGATIVE CASES ABOVE ARE ONLY WORTH HAVING IF THE PARSER REJECTS THEM. If the underlying
   * library ever started accepting one of those strings, that row would pass for the wrong reason —
   * so this asserts the pair: a valid expression is NOT null, which is what makes `null` meaningful.
   */
  it('distinguishes invalid from valid, so null is a real signal', () => {
    expect(nextCronRun('every 4 hours')).toBeNull();
    expect(nextCronRun('0 0 */4 * * *')).not.toBeNull();
  });
});
