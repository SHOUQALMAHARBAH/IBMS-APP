import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';
import { PERMISSIONS } from '../i18n/translations/permissions';
import { codeFromPermissionKey, permissionDescriptionKey } from '../i18n/permission-key';
import { describePermission, hasWrittenDescription } from './permission-descriptions';

/*
 * THE COVERAGE OF THE PERMISSION DESCRIPTIONS, in both directions.
 *
 * The office manager decides a grant by reading these lines. 219 codes, and a matrix of codes nobody can
 * read is a matrix nobody can use safely — so the gap has to be visible and it has to shrink.
 *
 * Two checks, and they are here rather than in the dictionary's own guards because they are about the
 * RELATIONSHIP between the catalogue and the text: the dictionary cannot know what codes exist, and the
 * catalogue cannot know what has been written. Parity and single-ownership are handled by
 * `lib/i18n/translations.test.ts` and are gained free by the text living there.
 *
 *   FORWARD   every catalogue code has a line in both languages.  ← ratcheted, 214 missing today
 *   BACKWARD  every `perm:` key names a code the catalogue has.   ← fail on any, 0 today
 *
 * ## Why the forward check is a ratchet and not a fail-on-any
 *
 * 214 lines are missing today. Switching a fail-on-gap guard on in a state that cannot pass would mean a
 * permanently red build, and a red build that everyone has learned to ignore guards nothing. So the budget
 * fails in BOTH directions: if the gap grows, and if it shrinks without the budget coming down with it.
 * The second half is what stops it rotting into a ceiling nobody lowers.
 *
 * **When the last line lands the budget is 0, and at 0 this IS a fail-on-any-gap guard** — there is no
 * separate switch to remember to throw.
 */

const CODES = PERMISSION_CATALOGUE.map((entry) => entry.code);

/**
 * How many catalogue codes have no ARABIC description yet. **ZERO** — the owner delivered all 219 on
 * 2026-09-30 and the ratchet's second half is what brought this number down: the suite failed with
 * "only 0 codes are missing, so lower MISSING_DESCRIPTION_BUDGET to 0" rather than passing quietly at 214.
 *
 * At 0 this IS a fail-on-any-gap guard, exactly as designed, with no switch to throw. It must never be
 * raised: a new permission ships with its line.
 */
const MISSING_DESCRIPTION_BUDGET = 0;

/**
 * How many codes still show the STORED English hint rather than reviewed English copy.
 *
 * The Arabic is reviewed; the English is not. Her file was Arabic-only, and the dictionary's parity guard
 * requires every key in both languages — correctly — so the EN value is `Permission.description` carried in
 * verbatim, which is the same text the fallback already served. That is honest but it is not copy, so the
 * gap is RATCHETED rather than left invisible: detected mechanically by comparing the EN value against the
 * catalogue's stored description, so no exemption list is needed and it self-heals as real English arrives.
 */
const CARRIED_ENGLISH_BUDGET = 214;

describe('permission descriptions cover the catalogue', () => {
  it('is not vacuous — the catalogue and the dictionary are both really being read', () => {
    // Without this, an empty import or a renamed export would make every check below pass on nothing,
    // which is the failure mode this repo has paid for four times.
    expect(CODES.length, 'the catalogue is empty or unreadable').toBeGreaterThan(200);
    expect(
      Object.keys(PERMISSIONS.AR).length,
      'the permissions dictionary is empty',
    ).toBeGreaterThan(0);
    expect(Object.keys(PERMISSIONS.AR).length).toBe(Object.keys(PERMISSIONS.EN).length);
  });

  it('has no more codes without a description than the recorded budget', () => {
    const missing = CODES.filter((code) => !hasWrittenDescription(code));
    expect(
      missing.length,
      `${missing.length} codes have no description, above the budget of ${MISSING_DESCRIPTION_BUDGET}. ` +
        'A new permission ships with its line — the office manager decides a grant by reading it, and a ' +
        `code with no line falls back to the stored English hint. First few: ${missing.slice(0, 5).join(', ')}`,
    ).toBeLessThanOrEqual(MISSING_DESCRIPTION_BUDGET);

    // THE OTHER HALF OF THE RATCHET. A budget left above the real gap stops being a ratchet and becomes a
    // ceiling, and this is what makes lowering it part of the work rather than an errand.
    expect(
      missing.length,
      `only ${missing.length} codes are missing a description, so lower MISSING_DESCRIPTION_BUDGET to ` +
        `${missing.length}. At 0 this check becomes fail-on-any-gap with no switch to throw.`,
    ).toBe(MISSING_DESCRIPTION_BUDGET);
  });

  it('has no more codes showing the carried English hint than the recorded budget', () => {
    // Mechanical, so no exemption list: a code whose EN value equals the catalogue's stored description has
    // not been given reviewed English yet. Both directions, like the Arabic ratchet.
    const stored = new Map(PERMISSION_CATALOGUE.map((e) => [e.code, e.description]));
    const carried = CODES.filter((code) => {
      const en = (PERMISSIONS.EN as Record<string, string | undefined>)[
        permissionDescriptionKey(code)
      ];
      return en !== undefined && en === stored.get(code);
    });
    expect(
      carried.length,
      `${carried.length} codes still show the stored English hint, above the budget of ${CARRIED_ENGLISH_BUDGET}.`,
    ).toBeLessThanOrEqual(CARRIED_ENGLISH_BUDGET);
    expect(
      carried.length,
      `only ${carried.length} codes still show the carried hint, so lower CARRIED_ENGLISH_BUDGET to that.`,
    ).toBe(CARRIED_ENGLISH_BUDGET);
  });

  it('has no description for a code the catalogue does not have', () => {
    // FAIL ON ANY, because there is nothing to ratchet: an orphan is a line for a code that was renamed or
    // withdrawn, and leaving it means the next reader of that code gets no line while a stale sentence sits
    // in the dictionary looking like coverage. The verbatim key shape is what makes this detectable — a
    // pattern-matched key would keep pairing the renamed code with the old sentence and report nothing.
    const orphans = Object.keys(PERMISSIONS.AR)
      .map((key) => codeFromPermissionKey(key))
      .filter((code): code is string => code !== null && !CODES.includes(code));
    expect(
      orphans,
      'a permission description names a code the catalogue does not have. It was probably renamed: move ' +
        'the line to the new code rather than deleting it, because the wording is reviewed work.',
    ).toEqual([]);
  });

  it('keys map to codes and back without loss', () => {
    // The guard above walks catalogue -> key -> catalogue, so the mapping has to be exactly reversible for
    // every real code, including the ones with dots and hyphens in the middle.
    for (const code of CODES) {
      expect(codeFromPermissionKey(permissionDescriptionKey(code))).toBe(code);
    }
    expect(codeFromPermissionKey('commonSave'), 'a non-permission key must not parse as one').toBeNull();
  });
});

describe('the stored English fallback', () => {
  it('is used for a code with no written line, and is not used when one exists', () => {
    // KEPT deliberately. Once the forward guard reaches 0 this branch is unreachable THROUGH THE CATALOGUE,
    // but `describePermission` is also reachable with a code the catalogue does not contain — a stale grant
    // row, or a code withdrawn between a page load and a render — and the stored hint beats nothing at all
    // for somebody deciding a grant.
    expect(describePermission('role.read', 'AR', 'stored hint')).not.toBe('stored hint');
    // NOT a catalogue code. Every one of the 219 now has a line, so the fallback is unreachable THROUGH the
    // catalogue — which is the design. It stays reachable with a code the catalogue does not contain: a
    // stale grant row, or a code withdrawn between a page load and a render. This assertion used
    // `claim.delete` until the owner's lines landed, and then correctly broke, because that code now has a
    // real Arabic line saying it does nothing today.
    expect(describePermission('never.was.a.code', 'AR', 'stored hint')).toBe('stored hint');
    // And with neither, NULL rather than the code: repeating the code beneath the code is noise that looks
    // like an explanation.
    expect(describePermission('never.was.a.code', 'AR', '   ')).toBeNull();
    expect(describePermission('never.was.a.code', 'AR')).toBeNull();
  });
});
