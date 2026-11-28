import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupOptional } from './translations';

/**
 * 🔴 THE FULL WALK §A ITEM 10 / DECISION 167/17 — THE PROVIDER SCREEN'S STANDING WORD IS THE
 * LICENCE SCREEN'S, BYTE FOR BYTE, AND ITS MAP IS TOTAL.
 *
 * `/provider-offices` printed a four-way branch over the DATE-ONLY lapse and called its negation
 * «ساري». Past expiry that boolean is `!renewalFiledOnTime`, which is `false` for four renewal
 * states — three of them EXPIRED with `mayPractise: false`. Measured on the owner's database
 * 2026-11-28: office B's licence expired 2025-12-31, `/regulatory-compliance` read «قيدَ التجديد»
 * and this screen read «ساري».
 *
 * The ruling is «تُصحَّح كلمة شاشة المزوّد لتطابق شاشة الترخيص» — correct the provider screen's
 * word to match the licence screen's. So this file asserts the two things that makes checkable:
 *
 *   1. THE WORDS ARE THE SAME, in both language halves, compared byte for byte against the
 *      `rcStanding*` values they were sliced from. ⛔ They are SEPARATE KEYS (decision 157 ruling
 *      2) — one key serving two screens is one key that cannot move — so nothing but a test can
 *      keep them equal, and a reword on one screen must fail here rather than silently diverge on
 *      a cross-office dashboard nobody is looking at.
 *
 *   2. THE MAP IS TOTAL over the six statuses. Decision 148's lesson: a vocabulary missing a
 *      member renders a BLANK CELL, because `translate()` returns `undefined` and React renders
 *      nothing — and `satisfies Labels<string>` proves nothing about coverage. The screen's map
 *      carries a real `satisfies Record<…>`, and this reads it out of the source so the claim does
 *      not rest on a type alone.
 */

/** `translations` is deliberately not exported — `lookupOptional` is the runtime-key route, and a
 *  key this file names wrongly comes back `undefined` rather than failing to compile, which is why
 *  every assertion below checks the source side for truthiness first. */
const AR = (key: string): string | undefined => lookupOptional('AR', key);
const EN = (key: string): string | undefined => lookupOptional('EN', key);

const SCREEN = join(
  __dirname,
  '..',
  '..',
  'app',
  '(app)',
  'provider-offices',
  'page.tsx',
);

/** The six statuses the api's `standing.status` union carries. Written out rather than imported:
 *  the web declares its own copy of the wire type, and the point of the totality test below is
 *  that the SCREEN covers all six, not that two type declarations agree. */
const STATUSES = [
  'NO_TERM_ON_RECORD',
  'ACTIVE',
  'RENEWAL_PENDING',
  'EXPIRED',
  'SUSPENDED',
  'CANCELLED',
] as const;

describe('the provider screen says what the licence screen says', () => {
  it.each([
    ['providerOfficesStandingRenewalPending', 'rcStandingRenewalPending'],
    ['providerOfficesStandingSuspended', 'rcStandingSuspended'],
    ['providerOfficesStandingCancelled', 'rcStandingCancelled'],
  ])('%s carries %s byte for byte, in both halves', (provider, licence) => {
    // NON-VACUITY FIRST. A typo in either key name would make both sides `undefined`, and
    // `undefined === undefined` passes — which is the shape of a test that proves nothing.
    expect(AR(licence), `${licence} has no Arabic value`).toBeTruthy();
    expect(EN(licence), `${licence} has no English value`).toBeTruthy();
    expect(AR(provider)).toBe(AR(licence));
    expect(EN(provider)).toBe(EN(licence));
  });

  it('«ساري» on the provider screen is the licence screen’s ACTIVE word, and nothing else', () => {
    /*
     * THE WORD THE DEFECT WAS. `providerOfficesInGoodStanding` already shipped as «ساري» and the
     * screen printed it for the NEGATION of a date-only boolean. It is now mapped to ACTIVE alone,
     * and ACTIVE is the one state decision 128 permits it to describe — quoted in this very
     * dictionary: «`rcStandingActive` («ساري») belongs to a term INSIDE its printed dates and to
     * nothing else».
     */
    expect(AR('providerOfficesInGoodStanding')).toBe(AR('rcStandingActive'));
    // AND THE OTHER DIRECTION, which is the half that would have caught the defect: the word must
    // NOT be the same as the renewal-pending one, or the correction would be invisible.
    expect(AR('providerOfficesInGoodStanding')).not.toBe(
      AR('providerOfficesStandingRenewalPending'),
    );
  });

  it('EXPIRED takes the provider screen’s own lapsed sentence, which says the business is blocked', () => {
    // ⛔ NOT `rcStandingExpired` («منتهي»). This screen's existing key says «منتهٍ — يُمنع العمل
    // الجديد», and the second clause is TRUE of EXPIRED: `mayPractise` is false in every EXPIRED
    // branch of the derivation. A cross-office reader needs the consequence, not just the state.
    expect(AR('providerOfficesLapsed')).toContain('يُمنع العمل الجديد');
  });
});

describe('the standing map on the provider screen is total', () => {
  const source = readFileSync(SCREEN, 'utf8');
  const map = source.slice(
    source.indexOf('const PROVIDER_STANDING_LABEL = {'),
    source.indexOf('} satisfies Record<'),
  );

  it('the map was found at all — this file is not asserting over an empty string', () => {
    expect(map).toContain('PROVIDER_STANDING_LABEL');
    expect(map.length).toBeGreaterThan(100);
  });

  it.each(STATUSES)('%s has a label key', (status) => {
    expect(map).toContain(`${status}:`);
  });

  it('every label key the map names exists in BOTH halves', () => {
    /*
     * The decision-148 half. A key present in the map and absent from the dictionary renders a
     * blank cell, and that is strictly worse than the raw status code it replaced — a reader sees
     * an empty standing column and has no way to tell it from a loading row.
     */
    const keys = [...map.matchAll(/:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBe(STATUSES.length);
    for (const key of keys) {
      expect(AR(key), `${key} has no Arabic value`).toBeTruthy();
      expect(EN(key), `${key} has no English value`).toBeTruthy();
    }
  });

  it('SUSPENDED and CANCELLED are mapped although the provider cannot reach them', () => {
    /*
     * ⚠️ THE UNREACHABILITY IS ASSERTED RATHER THAN LEFT IN A COMMENT.
     *
     * The provider's derivation is handed NO regulatory acts — register entry 97, closed by the
     * owner on 2026-10-21 — and only a `RegulatoryAction` produces either status, so neither can
     * appear on this screen today. They are mapped because the union is CLOSED and a partial map
     * renders a blank cell.
     *
     * This asserts the mechanism that makes them unreachable, so the day somebody passes real acts
     * to that derivation the claim in the comment stops being true and this fails — rather than the
     * comment quietly becoming a lie, which is the shape this repository keeps paying for.
     */
    const service = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'api',
        'src',
        'modules',
        'compliance-risk',
        'provider-office-state.service.ts',
      ),
      'utf8',
    );
    expect(service).toContain('NO_ACTS_VISIBLE_HERE');
    expect(service).toContain(
      'deriveLicenseStanding(term, NO_ACTS_VISIBLE_HERE, now, figures)',
    );
    // And the constant really is empty, so the name is not doing the work alone.
    expect(service).toContain(
      'const NO_ACTS_VISIBLE_HERE: readonly RegulatoryActRow[] = [];',
    );
  });
});
