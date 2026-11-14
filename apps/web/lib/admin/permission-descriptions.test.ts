import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
// 215 -> 214 on 2026-10-28: `customer.update`'s English was REWRITTEN, because the owner's strike
// of her own 2026-09-28 deferral made the stored sentence false — it said the permission does not
// cover date of birth or nationality, and now it does. The ratchet fired for exactly the reason it
// exists, and lowering it is the half of that rule that stops the list becoming a ceiling.
const CARRIED_ENGLISH_BUDGET = 214;

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
/*
 * 223 -> 230 ON 2026-11-10: the owner read the seven agent-written lines and approved them as
 * written (message 34 §3.5). The count rises by exactly seven and the list below is empty, so the
 * balance holds at 230 = 230 + 0 -- which is what makes this an approval that was RECORDED rather
 * than a list somebody tidied.
 */
const OWNER_REVIEWED_COUNT = 232;

/**
 * The four lines an agent wrote. Each is a placeholder in HER register, not a reviewed line.
 *
 * `provider.insurer.register` is deliberately ABSENT: she supplied its Arabic verbatim after the file,
 * which is why the reviewed count is 220 and not 219.
 */
const AWAITING_OWNER_REVIEW: string[] = [
  /*
   * EMPTY SINCE 2026-11-10, AND THAT IS AN APPROVAL RATHER THAN A CLEARED LIST.
   *
   * The owner read all seven and approved them AS WRITTEN (message 34 §3.5):
   *
   *   provider.office.administrator.invite · provider.insurance-company.administrator.invite ·
   *   retention.extend · retention.archive.retrieve · retention-schedule.update ·
   *   retention-schedule.confirm · conflict-of-interest.register.read
   *
   * So `OWNER_REVIEWED_COUNT` rises by seven to 230 and the balance holds at 230 = 230 + 0. Each
   * of the seven was written by an agent for the same mechanical reason -- the parity guard
   * requires both languages, so a code cannot ship without a line, and whoever ships it writes it
   * -- and each was a placeholder in HER register until she read it. Now none is. The last of them,
   * `conflict-of-interest.register.read`, is module 0-ب decision 36's disclosure-register READ code,
   * and all seven were waiting on OWNER DECISION 94's naming pass rather than pre-empting it.
   *
   * ⚠️ AND ONE OF THE SEVEN CAME BACK WITH SOMETHING ELSE, WHICH IS NOT A CHANGE TO ITS LINE.
   * For `retention.archive.retrieve` she supplied a NAME -- «استخراج سجل مؤرشف/محجوب» -- which is
   * the first owner-supplied row of DECISION 127's naming table, not an edit to the description.
   * The description here is approved unchanged. Do not apply the name as a description, and do not
   * read this list as covering names: 127 is a separate, unbuilt pass over all 230 codes, recorded
   * in `docs/module-1-design-reports.md` §6.3.
   *
   * THIS LIST IS NOT A RATCHET AND MUST NOT BECOME ONE. It legitimately GROWS the next time a
   * module ships a permission, and the balance check below is what refills it -- by name, on the
   * commit that ships the code. What must only grow is `OWNER_REVIEWED_COUNT`.
   *
   * AND IT REFILLED ON 2026-11-11, EXACTLY AS THAT PARAGRAPH SAID IT WOULD, with module 1's two
   * legal-values codes. Both lines were AGENT-WRITTEN and were placeholders in her register until
   * she read them; both were composed from runs already shipping elsewhere in the product
   * («تعليمات البنك المركزي الأردني رقم 9 لسنة 2026» from `rcStandingNoTermNote`, «المادة» and
   * «المرجع» from the same dictionary, «يقرأ» from 28 sibling descriptions here), and the
   * composition was reported to her in message 35's §6 table beside its slice sources.
   *
   * ⟶ AND IT EMPTIED AGAIN ON 2026-11-13: OWNER DECISION 133 ratified the strings table, and she
   *   did NOT approve those two lines as written — she REPLACED both with her own sentences. So
   *   `OWNER_REVIEWED_COUNT` rises by two to 232 and the balance holds at 232 = 232 + 0.
   *
   *   ⚠️ THAT IS A DIFFERENT OUTCOME FROM THE SEVEN ABOVE AND THE DIFFERENCE IS WORTH KEEPING.
   *   The seven were approved UNCHANGED, so the agent's words survived her reading. These two
   *   were not: hers are shorter, say «الأرقام القانونية» where the composed line said «القيم»,
   *   and drop the instrument's full name. ⟶ So a line sitting on this list is not a line that
   *   is probably fine — two of nine were rewritten — and the list is what makes that visible.
   *
   *   Both are SLICED byte-exact from `docs/decision-133-strings-ratified.md` and never retyped,
   *   and the test below re-slices from that file and compares, so a hand-edit to the dictionary
   *   fails by name.
   *
   * AND IT REFILLED AGAIN THE SAME DAY, with module 1's art. 15/d declaration code — exactly as
   * the paragraph above says it legitimately does. That line is AGENT-COMPOSED: every run in it
   * already ships («طلب عرض سعر» from `rfqNewRefusalAct`, «أقل من ثلاث شركات تأمين» from the
   * adviser's own window text, «المسؤولية التنظيمية على المكتب» the owner's own sentence, and the
   * verbs from 28 siblings here) but COMPOSED is not SLICED. The parity guard requires a line
   * before a code can exist at all, so the choice was to compose one and declare it, or not to
   * ship the permission.
   *
   * ⟶ `OWNER_REVIEWED_COUNT` stays 232 and the balance is 233 = 232 + 1. The sentence goes to her
   *   in this batch's report.
   */
  'declared-act.article-15-d.declare',
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

/*
 * THE OWNER'S OWN SENTENCES, RE-SLICED FROM HER DECISION FILE AND COMPARED BYTE FOR BYTE.
 *
 * OWNER DECISION 133 ratified the strings table on 2026-11-13 and replaced both agent-composed
 * `legal-value.*` lines with her own. The dictionary is not trusted to have been copied correctly:
 * it is proven against the file it was copied FROM, the shape `declared-act.config.spec.ts` uses
 * for the adviser's text and `legal-values-parity.spec.ts` uses for the instrument's figures.
 *
 * ⟶ AND THE REASON IT MATTERS HERE IS THE SAME REASON THE AWAITING LIST EXISTS. These lines are
 *   what an office administrator reads before granting a permission, and a silent edit would put
 *   an agent's words back under her name — which is precisely the state this batch just left.
 */
describe('OWNER DECISION 133 — the two legal-value descriptions are hers, byte for byte', () => {
  const REPO = join(__dirname, '..', '..', '..', '..');
  const D133 = join(REPO, 'docs', 'decision-133-strings-ratified.md');

  /** The first «…» span of the decision-133 table row whose site cell is `site`. */
  function ratified(site: string): string {
    const row = readFileSync(D133, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
      .find((cells) => cells.length >= 2 && cells[0] === site);
    expect(row, `decision 133 has no row for «${site}» — the slice source moved`).toBeDefined();
    const match = /«(.+?)»/.exec(row![1]);
    expect(match, `decision 133's row for «${site}» carries no quoted sentence`).not.toBeNull();
    return match![1];
  }

  it.each([
    ['legal-value.read', 'شرح `legal-value.read`'],
    ['legal-value.declare', 'شرح `legal-value.declare`'],
  ])('%s says exactly what she wrote', (code, site) => {
    expect(
      PERMISSIONS.AR[permissionDescriptionKey(code) as keyof typeof PERMISSIONS.AR],
      `the Arabic for ${code} is not byte-identical to OWNER DECISION 133's own table. It is HER ` +
        'sentence: re-slice it from docs/decision-133-strings-ratified.md rather than editing it ' +
        'here, and if the sentence itself needs to change that is hers, not ours.',
    ).toBe(ratified(site));
  });

  it('and neither is still declared as awaiting her review', () => {
    /*
     * The pair that makes the rewrite real rather than cosmetic. She did not approve the composed
     * lines — she replaced them — so leaving the codes on the awaiting list would claim her words
     * are still a placeholder, and removing them without taking her text would claim she approved
     * something she did not.
     */
    for (const code of ['legal-value.read', 'legal-value.declare']) {
      expect(
        AWAITING_OWNER_REVIEW,
        `${code} carries the owner's own ratified sentence now (decision 133), so it must not be ` +
          'declared as awaiting her review.',
      ).not.toContain(code);
    }
  });
});
