import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAKER_CHECKER_REGISTRY } from './maker-checker-pairs.config';

/**
 * ITEM C / DECISION 22 — `makerPermission` names the code that gates the MAKER's half, and this
 * guard is what keeps it an ANSWER rather than a plausible-looking string.
 *
 * ## THE GUARD CHECKS ENFORCEMENT, NOT EXISTENCE, and that is the whole point
 *
 * `refund.raise` is in the catalogue, is granted to roles, has a description on the Role matrix —
 * and gates NO ROUTE. It is the obvious thing to write in the Refund pair's field, it is wrong,
 * and an existence check would have accepted it happily. Recording an unenforced code in the one
 * place meant to answer "who may make this half" is worse than leaving the field empty, because
 * it reads as an answer.
 *
 * So the test is: does this code appear inside a `@RequirePermissions(...)` anywhere in the api?
 * That is what "gates a route" means, read off the routes themselves.
 *
 * ## AND IT CHECKS THE CATALOGUE TOO, IN THE OTHER DIRECTION
 *
 * A code that gates a route but is not in the seeded catalogue is a gate nobody can satisfy
 * (IMPROVEMENTS § 1.62), so both halves are asserted. `PERMISSIONS` lives in
 * `packages/db/prisma/seed-data/`, outside `@ibms/db`'s exported surface, so it is read as TEXT —
 * the same thing `role-scope.inventory.spec.ts` does, for the same reason.
 *
 * ## THE ONE NULL IS AN ANSWER AND IS HELD TO THAT STANDARD
 *
 * `AccessRecertificationItem`'s maker is the SUBJECT of the review. A person does not hold a
 * permission in order to be the one whose access is reviewed, so there is no gate to name and none
 * can be invented. The entry carries that reason in a comment beside the field, and the test below
 * requires the reason to be there — an empty field with a reason is an answer; an empty field
 * without one is a gap somebody will fill with a guess.
 */

const API_SRC = join(__dirname, '..');
const CATALOGUE = join(
  API_SRC,
  '../../../packages/db/prisma/seed-data/permissions.ts',
);
const REGISTRY_FILE = join(API_SRC, 'common', 'maker-checker-pairs.config.ts');

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.includes('.spec.')) {
      out.push(full);
    }
  }
}

/** Every code that appears inside a `@RequirePermissions(...)` — i.e. actually gates a route. */
function routeGatedCodes(): Set<string> {
  const files: string[] = [];
  walk(API_SRC, files);
  // A NON-VACUITY FLOOR FIRST. Without it a broken walk returns an empty set, every code reads as
  // unenforced, and this spec fails for the wrong reason — or worse, a future inverted assertion
  // passes against nothing. This guard's own reading has to be proven before it is used.
  expect(
    files.length,
    'the api source walk found almost nothing — this guard is reading an empty tree',
  ).toBeGreaterThan(400);

  const codes = new Set<string>();
  const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const call of haystack.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
    for (const quoted of call[1].matchAll(/'([^']+)'/g)) {
      codes.add(quoted[1]);
    }
  }
  expect(
    codes.size,
    'no @RequirePermissions call was parsed — the matcher has stopped matching',
  ).toBeGreaterThan(100);
  return codes;
}

/** The seeded catalogue, read as text because it sits outside `@ibms/db`'s exports. */
function catalogueCodes(): Set<string> {
  const text = readFileSync(CATALOGUE, 'utf8');
  const codes = new Set<string>();
  // BOTH quote styles — the catalogue is DOUBLE-quoted, and a single-quoted-only matcher
  // parsed ZERO codes. And the first repair arrived through a shell heredoc, which turned its
  // word boundaries into literal BACKSPACE characters: the regex compiled perfectly and matched
  // nothing. This function's own non-vacuity floor caught BOTH, which is what it is for.
  for (const m of text.matchAll(/code:\s*'([^']+)'|code:\s*"([^"]+)"/g)) {
    const code = m[1] ?? m[2];
    if (code) codes.add(code);
  }
  expect(
    codes.size,
    'parsed no codes out of the catalogue — the matcher has stopped matching',
  ).toBeGreaterThan(200);
  return codes;
}

describe('makerPermission (decision 22)', () => {
  const gated = routeGatedCodes();
  const catalogue = catalogueCodes();

  it('is present on EVERY pair — a missing field and an absent code must not look alike', () => {
    /*
     * `in` rather than a truthiness check, deliberately: `null` is a real, meaningful value here and
     * a truthy test would treat the one honest "there is no code" as an omission.
     */
    const missing = MAKER_CHECKER_REGISTRY.filter(
      (p) => !('makerPermission' in p),
    ).map((p) => p.dbCheckConstraint);
    expect(missing).toEqual([]);
    // Non-vacuity: the loop above proves nothing against an empty registry.
    expect(MAKER_CHECKER_REGISTRY.length).toBeGreaterThan(10);
  });

  it('REFUSES a code that gates no route — enforcement, not existence', () => {
    /*
     * THE ASSERTION ITEM C IS ABOUT. `refund.raise` is the worked example: in the catalogue, granted
     * to roles, described on the Role matrix, and gating nothing.
     */
    const unenforced = MAKER_CHECKER_REGISTRY.filter(
      (p) => p.makerPermission !== null && !gated.has(p.makerPermission),
    ).map((p) => `${p.dbCheckConstraint} -> ${p.makerPermission}`);
    expect(
      unenforced,
      'a makerPermission that gates no @RequirePermissions anywhere in the api. Measure it from ' +
        'the ROUTE that writes the maker field (scripts/measurements/maker-permissions.py), never ' +
        'from the field name — and never record a catalogue code that reads no route: it looks ' +
        'like an answer and is not one.',
    ).toEqual([]);
  });

  it('REFUSES a code that is not in the seeded catalogue either', () => {
    // The other direction: a gate nobody can satisfy makes the maker's half unreachable.
    const unknown = MAKER_CHECKER_REGISTRY.filter(
      (p) => p.makerPermission !== null && !catalogue.has(p.makerPermission),
    ).map((p) => `${p.dbCheckConstraint} -> ${p.makerPermission}`);
    expect(unknown).toEqual([]);
  });

  it('proves this guard can FAIL — `refund.raise` is in the catalogue and gates no route', () => {
    /*
     * THE NON-VACUITY CASE, and it is specific rather than general. Both assertions above pass
     * against a registry of sixteen correct values whether or not the two sets are being read
     * properly; this one pins the exact condition they exist to catch, using the exact code that
     * made it necessary.
     *
     * If `refund.raise` ever gains a route, this test fails — and that is the right failure: the
     * Refund pair's field would then need re-measuring, because a standalone refund-raise endpoint
     * is precisely the thing that would change the answer.
     */
    expect(catalogue.has('refund.raise')).toBe(true);
    expect(
      gated.has('refund.raise'),
      '`refund.raise` now gates a route — re-measure the Refund pair, whose maker is currently ' +
        '`endorsement.apply` because the refund is created inside the endorsement',
    ).toBe(false);
  });

  it('requires the ONE null to carry its reason beside it', () => {
    /*
     * An empty field with a reason is an answer; an empty field without one is a gap somebody
     * fills with a guess. Read off the registry FILE, because the reason lives in a comment — and a
     * comment is exactly where this repo has already lost a fact twice (a deleted constant that
     * survived in a test header; a model named only in a comment reading as "cleared").
     */
    const nulls = MAKER_CHECKER_REGISTRY.filter(
      (p) => p.makerPermission === null,
    );
    expect(nulls.map((p) => p.dbCheckConstraint)).toEqual([
      'AccessRecertificationItem_maker_checker_distinct',
    ]);

    const text = readFileSync(REGISTRY_FILE, 'utf8');
    const at = text.indexOf(
      "dbCheckConstraint: 'AccessRecertificationItem_maker_checker_distinct'",
    );
    expect(at).toBeGreaterThan(0);
    const block = text.slice(at, at + 900);
    expect(block).toContain('NONE, AND NONE CAN EXIST');
    expect(block).toContain('SUBJECT');
  });
});
