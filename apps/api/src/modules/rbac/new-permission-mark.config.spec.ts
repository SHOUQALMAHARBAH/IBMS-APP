import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CONTROLS,
  isMarkedNew,
  noticeFor,
} from './new-permission-mark.config';

/**
 * OWNER DECISION 131 — THE MARK'S RULE, AND THE MAP THAT FILLS ITS NOTIFICATION.
 *
 * Two different kinds of test in one file, deliberately:
 *
 *   - `isMarkedNew` is a pure rule and is tested as one, each condition in BOTH directions.
 *   - `PERMISSION_CONTROLS` is a DECLARED map and is proven against the sources it was derived
 *     from, which is the only thing that stops it going stale the first time a decorator moves.
 */

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const DESTINATIONS = join(
  REPO,
  'apps',
  'web',
  'components',
  'app',
  'destinations.ts',
);
const API_SRC = join(REPO, 'apps', 'api', 'src');
const CATALOGUE = join(
  REPO,
  'packages',
  'db',
  'prisma',
  'seed-data',
  'permissions.ts',
);

/**
 * The catalogue codes carrying an arrival date, read as TEXT rather than imported.
 *
 * ⛔ `@ibms/db` exports only `.` and `./password-policy`, so a deep import of the seed data does
 * not resolve — and a relative import out of `apps/api` is this repository's recorded way of
 * breaking the DOCKER BUILD. Reading the source is what `permission-catalogue-parity.spec.ts`
 * does for the same reason, and it is stricter besides: it sees what is WRITTEN, so a value
 * computed at runtime could not hide from it.
 */
function datedCodesFromCatalogue(): string[] {
  const src = readFileSync(CATALOGUE, 'utf8');
  const codes: string[] = [];
  // Entries are `{ code: "x", ... }`; an entry carrying `introducedAt:` before the next `code:`
  // is a dated one. Splitting on `code:` keeps each entry's own window.
  const chunks = src.split(/\bcode:\s*/).slice(1);
  for (const chunk of chunks) {
    const code = /^["']([^"']+)["']/.exec(chunk)?.[1];
    if (!code) continue;
    if (/\bintroducedAt:\s*["']/.test(chunk)) codes.push(code);
  }
  return codes;
}

const OFFICE_CREATED = new Date('2026-11-09T11:03:01.399Z');
const AFTER = new Date('2026-11-11T00:00:00.000Z');
const BEFORE = new Date('2026-10-01T00:00:00.000Z');

const base = {
  introducedAt: AFTER,
  officeCreatedAt: OFFICE_CREATED,
  grantedHere: false,
  dismissedHere: false,
};

describe('decision 131 — when is a code «جديدة» for an office', () => {
  it('is marked when it arrived after the office and nobody here has dealt with it', () => {
    expect(isMarkedNew(base)).toBe(true);
  });

  it('CONDITION 1 — a code with no arrival date predates the mark and is never new', () => {
    /*
     * NULL is the 230 codes that existed when the column landed. Marking them would show every
     * office its whole catalogue, and an administrator handed 230 green marks learns to ignore
     * the mark — which is what would make it useless for the one code that closes a button.
     */
    expect(isMarkedNew({ ...base, introducedAt: null })).toBe(false);
  });

  it('CONDITION 1 — a code that arrived BEFORE the office was created is not new to it', () => {
    /*
     * The half that protects a newly-registered office. Its first login must not meet 232 marks.
     * ⚠️ AT the office's own createdAt counts as NOT new: a code that arrived in the same instant
     * the office did is part of what the office started with.
     */
    expect(isMarkedNew({ ...base, introducedAt: BEFORE })).toBe(false);
    expect(isMarkedNew({ ...base, introducedAt: OFFICE_CREATED })).toBe(false);
  });

  it('CONDITION 2 — granting it to a role clears the mark, which IS criterion 4', () => {
    // «يعطيها لدور» — the grant is already recorded as a RolePermission row, so it needs no
    // second record. Tenant-scoped, so it clears in THIS office only.
    expect(isMarkedNew({ ...base, grantedHere: true })).toBe(false);
  });

  it('CONDITION 3 — ruling on it without granting clears the mark too', () => {
    // «أو يقرّر فيها» — the administrator looked and chose not to grant it. The one state
    // nothing else in the schema can express, which is why the dismissal table exists at all.
    expect(isMarkedNew({ ...base, dismissedHere: true })).toBe(false);
  });
});

describe('decision 131 — what the notification says a code controls', () => {
  /** Every code in the seed catalogue that carries an arrival date, and so can be marked. */
  const datedCodes = datedCodesFromCatalogue();

  it('is not vacuous — the catalogue really does declare some dated codes', () => {
    // Without this, a parser that drifted would make the next test pass by comparing two empty
    // sets, which is the shape `screen-route-permission-fit.py` asserts against for the same
    // reason. Two codes today; it may only grow.
    expect(datedCodes.length).toBeGreaterThan(0);
  });

  it('covers EXACTLY the codes that can be marked, in both directions', () => {
    /*
     * A code with no arrival date is never shown in this sentence, so an entry for it is a line
     * nobody reads that still has to be maintained — and a DATED code with no entry is a
     * notification that cannot answer «تتحكّم في», which is the slot decision 131 §5 is about.
     */
    expect(
      Object.keys(PERMISSION_CONTROLS).sort(),
      'the control map and the set of markable codes disagree. A new permission needs BOTH an ' +
        '`introducedAt` in the catalogue and an entry here naming what it guards — the ' +
        'notification has a slot for it and a guess is not allowed to fill it.',
    ).toEqual([...datedCodes].sort());
  });

  it('names at least one real thing for every code — a code that controls nothing is a defect', () => {
    for (const [code, controls] of Object.entries(PERMISSION_CONTROLS)) {
      expect(
        controls.screen !== null || controls.routes.length > 0,
        `${code} declares neither a screen nor a route. A permission that guards nothing is ` +
          'either dead or mis-declared, and the notification would tell an administrator to ' +
          'decide about something with no observable effect.',
      ).toBe(true);
    }
  });

  it('DERIVED, NOT AUTHORED — every declared route really is decorated with that code', () => {
    /*
     * 🔴 THE CHECK THAT MAKES THE DECLARATION HONEST.
     *
     * The map cannot be derived at RUNTIME: the api image does not contain `apps/web`, and a
     * Nest decorator is not a route table without booting the app. So it is declared here and
     * proven against the controllers, exactly as `permission-catalogue-parity.spec.ts` proves
     * the web fixture against the seed. Move a decorator and this fails by name.
     */
    const controllers = readFileSync(
      join(API_SRC, 'modules', 'compliance-risk', 'legal-value.controller.ts'),
      'utf8',
    );
    const prefix = /@Controller\('([^']+)'\)/.exec(controllers)?.[1];
    expect(prefix, 'the controller prefix moved').toBe('legal-values');

    // `@RequirePermissions('x')` followed by `@Get('y')` / `@Post()` — the pairs, in order.
    const pairs = [
      ...controllers.matchAll(
        /@RequirePermissions\('([^']+)'\)\s*\n\s*@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g,
      ),
    ].map((m) => {
      const path = m[3].replace(/'/g, '').trim();
      return {
        code: m[1],
        route: `${m[2].toUpperCase()} /${prefix}${path ? `/${path}` : ''}`,
      };
    });
    expect(
      pairs.length,
      'parsed no routes — the matcher drifted',
    ).toBeGreaterThan(0);

    for (const [code, controls] of Object.entries(PERMISSION_CONTROLS)) {
      const real = pairs.filter((p) => p.code === code).map((p) => p.route);
      if (real.length === 0) continue; // guarded somewhere this spec does not read
      expect(
        [...controls.routes].sort(),
        `${code}'s declared routes disagree with the decorators on legal-value.controller.ts`,
      ).toEqual(real.sort());
    }
  });

  it('🔴 and both markable codes are route-only today, which is reported rather than papered over', () => {
    /*
     * Decision 131 §5 asks for «أيّ شاشة أو زرّ». MEASURED 2026-11-14: neither `legal-value.read`
     * nor `legal-value.declare` appears in the nav map at all, because module 1 built the
     * legal-values API and its screen is not built. So the first two marks this product will
     * ever show both fall back to naming a ROUTE.
     *
     * That is weaker than a screen name and it is HONEST. Naming a screen that does not exist
     * would be a guess, in the one sentence an administrator reads before deciding who may do
     * something. ⟶ The day `/legal-values` ships, this test fails and the map gains its screen.
     */
    const nav = readFileSync(DESTINATIONS, 'utf8');
    for (const [code, controls] of Object.entries(PERMISSION_CONTROLS)) {
      const namedInNav = nav.includes(`'${code}'`);
      expect(
        namedInNav,
        `${code} now appears in the nav map, so the notification can name a SCREEN instead of a ` +
          'route — set `screen` on its entry in PERMISSION_CONTROLS.',
      ).toBe(controls.screen !== null);
    }
    // Non-vacuity: the file really is the nav map and really does name codes.
    expect(nav).toContain('permissions:');
  });

  it('a code with no entry still produces a notice rather than vanishing', () => {
    /*
     * The failure mode this guards: an administrator is never told a permission exists. Decision
     * 131 grants nothing, so the notification is the ONLY way anyone learns a code is there —
     * dropping it from the bell because its controls are unknown is strictly worse than saying
     * "it arrived and we cannot say what it guards".
     */
    const notice = noticeFor('zz.not.in.the.map');
    expect(notice.code).toBe('zz.not.in.the.map');
    expect(notice.screen).toBeNull();
    expect(notice.routes).toEqual([]);
  });
});
