import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { currentUtcMonthRange, previousUtcMonthRange } from './period.util';

/*
 * OWNER DECISION 58 — WHICH DEFAULT MONTH, AND THE TWO KINDS OF CALLER THAT MUST NOT
 * BE CHANGED TOGETHER.
 *
 * Her words on `/dashboards/sales`: «قسم العملاء المحتملون بيطلع 0 مع إنه في عملاء
 * محتملون جدد و عملاء محوّلون». Measured at the time: 120 leads, every one created
 * 6–17 October, against a default window of the PREVIOUS calendar month — September,
 * which held zero. The screen was telling the truth about a month she had not asked
 * about.
 *
 * `previousUtcMonthRange` could not simply be repointed, because it has two kinds of
 * caller with OPPOSITE semantics:
 *
 *   A READER'S DEFAULT — what a dashboard shows when nobody chose a period. Two:
 *   `sales-dashboard` and `policy-dashboard`, both `resolvePeriod(…QueryDto)`.
 *
 *   A SCORING JOB'S PERIOD — `insurer-performance` and `employee-performance`'s
 *   `resolvePeriodFromDto(Compute…Dto)`, their two schedulers, and
 *   `planning-export.config.ts#resolvePeriodLabel`. A month is scored once it has
 *   FULLY ELAPSED; pointing these at the current month writes a performance score for
 *   a month that is not over — wrong by construction and silent.
 *
 * ## WHY THIS FILE EXISTS AT ALL
 *
 * Measured before writing it: with the sales and policy defaults changed, every one of
 * the 25 management-reporting spec files still passed — 197 tests. **The default a
 * reader actually sees was observed by nothing**, which is exactly why a September
 * window survived into her walk. This is the first observer, and it is a SHAPE guard
 * rather than a list, so a third dashboard added later is covered the day it is written.
 */

/*
 * FILE-SCOPED, NEVER GLOBAL. This spec reads every `.ts` file under `apps/api/src`, and
 * two of its tests timed out at vitest's 5000ms default in the FULL 278-file run while
 * passing in isolation — the recorded trap, with four sibling inventory specs in this
 * same directory already carrying this line. Raising `apps/api`'s own budget would raise
 * it for ~3,500 ordinary tests where 5 seconds is a real signal.
 *
 * A guard that passes when run ALONE is not a guard that passes.
 */
vi.setConfig({ testTimeout: 30_000 });

const API_SRC = join(__dirname, '..');

/** Read ONCE for the whole file. Four tests walked it independently, which is what the
 *  timeout above was really reporting — the budget hides the waste, this removes it. */
let cached: string[] | null = null;
function apiSources(): string[] {
  if (cached === null) cached = tsFilesUnder(API_SRC);
  return cached;
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...tsFilesUnder(p));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Comments stripped: a sentence ABOUT a default is not a default. The
 *  `check:seed-sweeps` lesson — a model named only in a comment once read as
 *  "cleared", and this guard would otherwise flag the note in `period.util.ts`
 *  that explains the very distinction it is checking. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('owner decision 58 — the two month defaults are not interchangeable', () => {
  it('the reader default and the scoring default are genuinely different months', () => {
    // A NON-VACUITY FLOOR, first. Every assertion below is about which of two
    // functions a caller uses, and all of it is satisfied by two functions that
    // return the same thing — the clean-nothing shape this repository has paid for.
    const now = new Date(Date.UTC(2026, 9, 28, 11, 0, 0)); // 2026-10-28
    expect(currentUtcMonthRange(now).periodLabel).toBe('2026-10');
    expect(previousUtcMonthRange(now).periodLabel).toBe('2026-09');
    // And the reader's window CONTAINS `now`, which is the whole claim.
    expect(currentUtcMonthRange(now).periodStart.getTime()).toBeLessThanOrEqual(
      now.getTime(),
    );
    expect(currentUtcMonthRange(now).periodEnd.getTime()).toBeGreaterThan(
      now.getTime(),
    );
    // The scoring window does NOT, which is its reason for existing.
    expect(previousUtcMonthRange(now).periodEnd.getTime()).toBeLessThanOrEqual(
      now.getTime(),
    );
  });

  it('crosses a January boundary in both directions', () => {
    // The off-by-one a mid-year test cannot see: month 0 minus one is December of the
    // previous YEAR, and month 11 plus one is January of the next.
    const jan = new Date(Date.UTC(2027, 0, 5));
    expect(currentUtcMonthRange(jan).periodLabel).toBe('2027-01');
    expect(previousUtcMonthRange(jan).periodLabel).toBe('2026-12');
    const dec = new Date(Date.UTC(2026, 11, 20));
    expect(currentUtcMonthRange(dec).periodLabel).toBe('2026-12');
    expect(currentUtcMonthRange(dec).periodEnd.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('every READER default is the current month — a `resolvePeriod(…QueryDto)`', () => {
    /*
     * Found by SHAPE, so a third dashboard is covered the day somebody writes it
     * rather than when somebody remembers to add it to a list. The shape is the
     * method name `resolvePeriod` taking a `…QueryDto`, which is what distinguishes
     * a reader from a job in this module and is stated in `period.util.ts`.
     */
    const readers: { file: string; body: string }[] = [];
    for (const file of apiSources()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const m =
        /resolvePeriod\s*\(\s*\w+\s*:\s*\w*QueryDto\s*\)[\s\S]{0,900}?\n {2}\}/.exec(
          src,
        );
      if (m) readers.push({ file, body: m[0] });
    }
    // THE FLOOR: a regex that stops matching reports a clean nothing, and two
    // dashboards is the measured figure.
    expect(
      readers.length,
      'no `resolvePeriod(…QueryDto)` was found at all — the matcher broke, which reads exactly like a clean result',
    ).toBeGreaterThanOrEqual(2);

    for (const { file, body } of readers) {
      expect(
        body,
        `${file} defaults a READER to the previous month — owner decision 58 says a reader who chose no period is asking about THIS month`,
      ).not.toContain('previousUtcMonthRange');
      expect(
        body,
        `${file} has a reader default that calls neither month helper`,
      ).toContain('currentUtcMonthRange');
    }
  });

  it('every SCORING default is still the previous month — a `resolvePeriodFromDto(Compute…Dto)`', () => {
    /*
     * The half that must NOT move, and it is the one with a real consequence: a score
     * written for a month still running is a performance figure about an incomplete
     * month, stored and then read as though it were final.
     */
    const jobs: { file: string; body: string }[] = [];
    for (const file of apiSources()) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const m =
        /resolvePeriodFromDto\s*\(\s*\w+\s*:\s*Compute\w*Dto\s*\)[\s\S]{0,900}?\n {2}\}/.exec(
          src,
        );
      if (m) jobs.push({ file, body: m[0] });
    }
    expect(
      jobs.length,
      'no `resolvePeriodFromDto(Compute…Dto)` was found at all — the matcher broke',
    ).toBeGreaterThanOrEqual(2);

    for (const { file, body } of jobs) {
      expect(
        body,
        `${file} scores the CURRENT month — a month that is not over yet, so the figure describes an incomplete period and is then stored as final`,
      ).not.toContain('currentUtcMonthRange');
      expect(body, `${file} scores with neither month helper`).toContain(
        'previousUtcMonthRange',
      );
    }
  });

  it('no scheduler reaches for the reader default', () => {
    /*
     * The schedulers call the helper directly rather than through a `resolve…`
     * method, so the two shape checks above cannot see them. Asserted separately
     * rather than by widening one of those regexes, because a scheduler and a route
     * are different things and a guard that conflated them would pass while one of
     * them was wrong.
     */
    const schedulers = apiSources().filter((f) => f.endsWith('.scheduler.ts'));
    expect(schedulers.length, 'no scheduler files found').toBeGreaterThan(0);
    for (const file of schedulers) {
      expect(
        stripComments(readFileSync(file, 'utf8')),
        `${file} is a periodic job and must score an ELAPSED month, never the current one`,
      ).not.toContain('currentUtcMonthRange');
    }
  });
});
