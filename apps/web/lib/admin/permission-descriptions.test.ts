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
/*
 * 215, RAISED BY EXACTLY ONE — and this file's own rule says the budget must NEVER be raised, so the
 * reason is recorded rather than the number quietly bumped.
 *
 * That rule exists to stop a budget being raised to HIDE a regression: a line that was real English
 * reverting to the carried hint. This is the other case — item (f) shipped a NEW code, and a new
 * code's English IS the carried catalogue description by construction, because the dictionary's
 * parity guard requires both languages and nobody writes reviewed copy in the same breath as a
 * route. So the figure tracks "codes awaiting real English", and it grows when a code ships for the
 * same reason `AWAITING_OWNER_REVIEW` does.
 *
 * What must never happen is this number going up while the CODE COUNT stays the same. That would be
 * a reversion, and it is what the rule is about.
 */
const CARRIED_ENGLISH_BUDGET = 215;

/**
 * CODES WHOSE ARABIC IS **NOT** THE OWNER'S, and the balance check that stops this list rotting.
 *
 * ## Why this exists: the dictionary's own header had become false
 *
 * `translations/permissions.ts` said "All 219 lines were written by the owner" — true on 2026-09-30
 * and false from the first permission added afterwards. Measured against her delivery commit
 * (`b366561`): her file carried **219** codes, the dictionary now carries 224, and FIVE post-date
 * it. Four of those five were written by an agent to satisfy the parity guard, which requires every
 * key in both languages and therefore makes shipping a code without Arabic impossible.
 *
 * That matters more than a stale count. The reason she delivered the Arabic as a FILE was that "219
 * hand-copied strings is 219 chances of a silent transcription error, and a JSON file can be checked
 * rather than trusted". A header asserting every line is hers makes an agent's line
 * INDISTINGUISHABLE from hers — the one property the file delivery existed to provide.
 *
 * ## Why a declared list, when every other guard here is mechanical
 *
 * `CARRIED_ENGLISH_BUDGET` needs no list because carried English is DETECTABLE: the EN value equals
 * the catalogue's stored description. Authorship is not detectable from the text. There is nothing to
 * compare against, so the list is unavoidable — and a declared list is exactly the kind of second
 * home that rots, which is what the balance check below is for.
 *
 * ## The balance check is the mechanism; the list alone would be decoration
 *
 * `OWNER_REVIEWED_COUNT + AWAITING_OWNER_REVIEW.length` must equal the number of codes. So:
 *
 *   - ship a new code and forget to list it  -> the totals disagree and the build says so BY NAME.
 *   - she reviews a line                     -> remove it here, raise the count, still balances.
 *
 * This is deliberately NOT a ratchet. `AWAITING_OWNER_REVIEW` legitimately GROWS when a module ships
 * a permission, so a must-only-shrink rule would be wrong and would teach somebody to edit it around.
 * What must only grow is `OWNER_REVIEWED_COUNT`.
 */
/*
 * 223 — AND IT WENT DOWN, WHICH THIS GUARD'S DESIGN DID NOT ANTICIPATE.
 *
 * The balance was built for codes being ADDED. Module 0 close decision 3 REMOVED one:
 * `retention-schedule.manage` was withdrawn and split into `.update` and `.confirm`, and the
 * withdrawn code took HER Arabic line with it — it was one of the 219 she delivered. So the
 * owner-reviewed count must come DOWN by one, or this file would still be crediting her with a line
 * for a code that no longer exists.
 *
 * That is the honest accounting and it is worth stating: a reviewed count that only ever rises would
 * drift upward every time a code is retired, and the drift would look like progress.
 */
const OWNER_REVIEWED_COUNT = 223;

/**
 * The four lines an agent wrote. Each is a placeholder in HER register, not a reviewed line.
 *
 * `provider.insurer.register` is deliberately ABSENT: she supplied its Arabic verbatim after the file,
 * which is why the reviewed count is 220 and not 219.
 */
const AWAITING_OWNER_REVIEW: string[] = [
  /*
   * ONE ENTRY, AND THE GUARD PUT IT THERE — item (f)'s new code, whose Arabic an agent wrote because
   * the parity guard requires both languages and a code therefore cannot ship without it. The list
   * was EMPTY for exactly one commit after the owner wrote all four of the previous module's codes,
   * and the balance check then failed on the next code shipped, by name. That is the whole design:
   * the list refills itself rather than needing somebody to remember.
   */
  'provider.office.administrator.invite',
  /*
   * Item (f)'s COMPANY half, shipped in the same close. Its Arabic was written by an agent for
   * the same reason the office one's was: the parity guard requires both languages, so a code
   * cannot ship without a line, and whoever ships it writes it.
   */
  'provider.insurance-company.administrator.invite',
  /*
   * Batch 5 group 7b's one new code. Its Arabic was written by an agent for the same reason the two
   * above were: the parity guard requires both languages, so a code cannot ship without a line.
   * Decision 94's naming pass is hers; this is a line awaiting it rather than a pre-emption of it.
   */
  'retention.extend',
  /*
   * Batch 5 group 7c's one new code, the same situation as the line above it: written by an agent
   * because the parity guard requires both languages, and awaiting decision 94's pass rather than
   * pre-empting it.
   */
  'retention.archive.retrieve',
  /*
   * The two halves of the split retention code. Their Arabic was written by an agent — the withdrawn
   * umbrella's line was HERS, and a split is not a translation, so neither successor inherits it.
   */
  'retention-schedule.update',
  'retention-schedule.confirm',
  /*
   * MODULE 0-ب, decision 36 — the disclosure register's READ code. Its Arabic was written by an
   * agent for the same reason every entry above it was: the parity guard requires both languages, so
   * a code cannot ship without a line.
   *
   * AND THIS ONE CARRIES AN EXTRA REASON TO BE READ: a code named
   * `conflict-of-interest.disclose` ALREADY EXISTS, and it is about the OTHER object — the flagged
   * disclosure on a recommendation, detected by a commission heuristic and acknowledged by a second
   * person. Both dictionary lines for the new code state that distinction, because two codes sharing
   * a prefix and meaning different things is exactly where a grant gets made on the wrong one.
   */
  'conflict-of-interest.register.read',
  /*
   * The owner wrote all four of the previous entries, and that remains the goal state rather than a
   * disabled guard. The balance check below still holds (224 = 224 + 0) and still fails by name the
   * moment a code ships without being declared here, which is the only thing this list was for.
   *
   * Two of the four were CORRECTED before being applied, which is why the count moved by four
   * rather than by two: `provider.office-state.read` had said the code does not reach the office's
   * own data, and the view exposes eighteen columns of it; `insurer.company.link` and `.unlink` had
   * omitted that linking locks the office's own copy of a company's facts to read-only. Corrected in
   * the ARABIC, never in the code — the owner's instruction, and the right direction, because the
   * code is what the description is about.
   */
];

describe('whose Arabic is it — provenance, because the text cannot say', () => {
  it('BALANCES: every code is either the owner-reviewed set or declared as awaiting her', () => {
    /*
     * The assertion that makes the list a guard. A code shipped without being declared here is
     * silently claimed as the owner's work, which is precisely what went wrong before this existed.
     */
    expect(
      OWNER_REVIEWED_COUNT + AWAITING_OWNER_REVIEW.length,
      `${CODES.length} codes exist, but ${OWNER_REVIEWED_COUNT} are recorded as owner-reviewed and ` +
        `${AWAITING_OWNER_REVIEW.length} as awaiting review. A new permission's Arabic is written by ` +
        'whoever ships it, so add its code to AWAITING_OWNER_REVIEW — leaving it out claims the owner ' +
        'wrote a line she has never seen.',
    ).toBe(CODES.length);
  });

  it('every code awaiting review is a REAL code — the list cannot go stale', () => {
    // A renamed or withdrawn code left here would keep the balance arithmetic working while naming
    // nothing, which is the one way this guard could pass while describing a fiction.
    for (const code of AWAITING_OWNER_REVIEW) {
      expect(
        CODES,
        `${code} is declared as awaiting the owner's review and is not in the catalogue — re-point it rather than deleting it.`,
      ).toContain(code);
    }
  });

  it('and each one DOES have a line, so this is about review and not about absence', () => {
    // Not a tautology against the forward check: that one asserts the COUNT of missing lines, and a
    // code could in principle be both unlisted-missing and listed-here. These are different claims.
    //
    // VACUOUS WHILE THE LIST IS EMPTY, and that is stated rather than hidden: with nothing awaiting
    // review this loop runs zero times and passes. It is kept because the list is expected to refill
    // the next time a module ships a permission, and a guard deleted at zero is a guard nobody
    // restores. The BALANCE check above is what is load-bearing today.
    for (const code of AWAITING_OWNER_REVIEW) {
      expect(
        hasWrittenDescription(code),
        `${code} is listed as awaiting review but has no written line at all — it belongs in the forward gap, not here.`,
      ).toBe(true);
    }
  });
});

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
