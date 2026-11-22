import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 A SPEC THAT CAN REACH `/` MUST MOCK WHAT `/` READS.
 *
 * ## The miss this exists to stop, which is mine
 *
 * Message 51 §1 made the home page greet a person with their role's NAME rather than its machine
 * code (decision 157), so it reads `user.roleNames` — a new field on `/auth/me`. A fixture
 * without it makes `user.roleNames.length` throw, React unmounts the shell, and the screen renders
 * «This page couldn't load»: a broken SCREEN rather than a stale mock, which is the trap
 * `bilingual-prose-screenshots.spec.ts` already records for `/insurance-programs`.
 *
 * I searched for affected specs with `grep goto("/")`, found two, fixed both, and **CI failed on a
 * third**. `password-change.spec.ts` never calls `goto("/")` — it fills the onboarding form and
 * the app REDIRECTS there, asserting `toHaveURL(/\/$/)` and then the Primary nav. A search for the
 * navigation misses every spec that arrives somewhere.
 *
 * ⟶ So the reach test is the UNION of three shapes, and the guard lives in the unit suite, which
 *   reads the Playwright specs as text (the established `apps/web/test/` pattern). It fails in
 *   seconds rather than twenty minutes into a CI run.
 *
 * ## ⛔ WHY THE SCREEN IS NOT MADE DEFENSIVE INSTEAD
 *
 * A `?? []` on `user.roleNames` would make all 121 stale fixtures pass — and would also mean that
 * if `/auth/me` ever genuinely stopped sending the field, the home page would quietly greet
 * everybody as roleless instead of failing. That is the hazard message 47 recorded for
 * `/insurance-programs`: ⛔ never hide a wire shape the API is asserted to send.
 *
 * ## Why only the specs that can REACH `/`
 *
 * 123 e2e files mock `/auth/me` and the overwhelming majority never render the home page, so
 * requiring the field everywhere would be 121 edits for 4 real cases and churn on files that
 * cannot be affected. The reach predicate is what keeps the obligation where the risk is.
 */

const E2E = join(__dirname, '..', 'e2e');

/** The fields `app/(app)/page.tsx` reads off the session and would throw without. */
const REQUIRED_ON_HOME = ['roleNames'] as const;

/**
 * Three ways a spec ends up on `/`. The union matters: each one alone misses real cases.
 *  - it navigates there itself
 *  - it asserts it ARRIVED there, which is how a redirect reads
 *  - it asserts the app shell's own navigation, which only the shell renders
 */
const REACHES_HOME = [
  /goto\(\s*["'`]\/["'`]\s*\)/,
  /toHaveURL\(\s*\/\\\/\$\//,
  /toHaveURL\(\s*["'`]\/["'`]\s*\)/,
  /navigation["'`],\s*\{\s*name:\s*["'`]Primary["'`]/,
];

/**
 * 🔴 COMMENTS STRIPPED, AND THIS WAS NOT A PRECAUTION — the first version of this file had the
 * defect it exists to catch.
 *
 * Every fixture fixed in this batch carries a comment EXPLAINING why `roleNames` is there, and
 * those comments contain the word. So a plain `src.includes('roleNames')` matched the comment,
 * and the plant — deleting the field from the fixture CI had just failed on — left this guard
 * GREEN. A guard that reads its own explanatory prose as the thing it requires is worse than no
 * guard: it reports a clean pass over the exact defect.
 *
 * ⚠️ That is the comment-quotes-the-pattern class for the TENTH time in this repository, and the
 * first nine are all recorded. Reproduced here inside the file written to stop it.
 *
 * ⛔ NEWLINES ARE KEPT, so a line number still means something to whoever reads a failure.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function specs(): { name: string; src: string }[] {
  return readdirSync(E2E)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((name) => ({
      name,
      src: stripComments(readFileSync(join(E2E, name), 'utf8')),
    }));
}

describe('e2e fixtures for specs that can reach the home page', () => {
  it('finds specs that reach `/` at all — the predicate is not vacuous', () => {
    /*
     * NON-VACUITY, and it is the whole value of this file. A predicate that matched nothing would
     * report a clean pass over an empty set, which is exactly the shape that let the defect
     * through in the first place.
     */
    const reaching = specs().filter(({ src }) =>
      REACHES_HOME.some((p) => p.test(src)),
    );
    expect(
      reaching.length,
      'no spec was detected as reaching `/`. The matchers above have stopped matching, so the ' +
        'assertion below is passing over nothing.',
    ).toBeGreaterThanOrEqual(4);
  });

  it('every one of them mocks the fields the home page reads', () => {
    const offenders: string[] = [];
    for (const { name, src } of specs()) {
      if (!REACHES_HOME.some((p) => p.test(src))) continue;
      // Only specs that mock the session at all — one that lets the real call through is not
      // carrying a fixture to keep current.
      if (!src.includes('auth/me')) continue;
      for (const field of REQUIRED_ON_HOME) {
        if (!src.includes(field)) offenders.push(`${name} is missing \`${field}\``);
      }
    }
    expect(
      offenders,
      'a spec can land on `/` with an `/auth/me` fixture the home page cannot read. The screen ' +
        'will render «This page couldn’t load», which reads as a broken screen rather than a ' +
        'stale mock. ⛔ Add the field to the fixture — do NOT make the screen defensive, which ' +
        'would hide a wire shape the API is asserted to send.',
    ).toEqual([]);
  });

  it('and the home page really does read every field this file requires', () => {
    /*
     * THE OTHER DIRECTION. Without this the list above could outlive the screen — a field removed
     * from `page.tsx` would leave an obligation on four specs for no reason, and the next person
     * would have no way to know it was stale.
     */
    const page = readFileSync(
      join(__dirname, '..', 'app', '(app)', 'page.tsx'),
      'utf8',
    );
    for (const field of REQUIRED_ON_HOME) {
      expect(
        page.includes(`user.${field}`),
        `${field} is required of every home-reaching fixture but the home page no longer reads ` +
          'it. Remove it from REQUIRED_ON_HOME.',
      ).toBe(true);
    }
  });
});
