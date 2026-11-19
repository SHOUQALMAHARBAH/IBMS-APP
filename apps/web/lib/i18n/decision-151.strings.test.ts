import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 151 — RULINGS 1-أ, 2-أ, 4-أ AND 5-أ, RE-SLICED FROM HER ANNEX.
 *
 * Four rulings, nineteen spans, and one table that states the finished text of all twenty-one
 * keys the decision touches:
 *
 *   §١  ruling 1-أ — a DEAD SENTENCE on the users screen. `usrSelfServiceSignupCreatesAn`
 *                    opened by describing what self-service signup creates, on a platform
 *                    where `POST /auth/signup` has been closed in production since message 41.
 *   §٢  ruling 2-أ — SEVEN strings citing one of OUR OWN documents by clause: «(الجزء 5.1)»,
 *                    «(البند 10.6، يُسجَّل)», «وفق الجزء 4.2 —». A reader has nowhere to look
 *                    those up. ⛔ `iassetIntro` KEEPS «البند 8.1 من معيار ISO 27001», because
 *                    ISO 27001 is a document the reader CAN look up — that is the whole
 *                    discriminator, and `check:process-prefix` now carries it as its one
 *                    declared exemption rather than as a habit.
 *   §٤  ruling 4-أ — NINE strings: «الامتثال» ⟶ «الالتزام».
 *   §٥  ruling 5-أ — TWO spans on the licence screen that talk about the CODE rather than
 *                    about the licence.
 *
 * ## ⛔ NOTHING HERE IS RETYPED
 *
 * Every expected string is read out of `docs/decision-151-ratified-strings.md` §٧ AT TEST TIME.
 * A test holding its own copy of her Arabic is a second home for it, free to agree with a
 * dictionary that drifted the same way — which is how a hand-spelled anchor drifted by one
 * shadda on 2026-11-17 and reported zero occurrences of a span plainly in the file.
 *
 * ## ⚠️ §٣ IS NOT BUILT, AND ITS ABSENCE IS ASSERTED RATHER THAN SKIPPED
 *
 * Two of §٧'s twenty-one rows — `orgUnitNameEn` and `orgUnitNameAr` — belong to ruling 3-أ,
 * which her own annex defers in terms: **«يُبنى بعد نسخة العرض»**, built after the demo
 * version. The rehearsal is 25 November. So those two are pinned in the NOT-YET-BUILT
 * direction below: whoever builds §٣ must come here and move them deliberately, rather than
 * finding a test that quietly passed either way.
 *
 * ## ⚠️ AND NOTHING HERE NEEDED COMPOSING WITH 146 OR 150, WHICH WAS MEASURED, NOT ASSUMED
 *
 * §٧ warns that it is decision 151's output ALONE, and that whatever decisions 146 and 150
 * change in the same strings is applied by their own spans. Measured 2026-11-19: the
 * intersection of §٧'s twenty-one keys with decision 146 annex §٣'s fifty-three and with
 * decision 150's forty-eight is EMPTY in both directions. So §٧'s text is the shipping text,
 * and a `toBe` is honest here. ⛔ If a later ruling touches one of these keys, that stops being
 * true and this comment is where to start.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ANNEX = join(REPO, 'docs', 'decision-151-ratified-strings.md');

/**
 * §٧'s two-column table — `| المفتاح | النصّ بعد القرار ١٥١ |` — as a map.
 *
 * ⚠️ SLICED BY SECTION AND COLUMN COUNT, never by line number. The owner appended
 * «## تكملة القرار ١٥١» BELOW the rulings table of the parent paper, so every line under it has
 * already moved once; she appends addenda routinely. The two-cell filter also keeps §١/§٢/§٤/§٥
 * out, which are five-column tables carrying some of the same keys — keying on the key alone
 * would pick whichever came first and compare against a «was» rather than a «became».
 */
function ratifiedText(): Map<string, string> {
  const body = readFileSync(ANNEX, 'utf8');
  const start = body.indexOf('## ٧ —');
  const end = body.indexOf('## ٨ —');
  expect(
    start >= 0 && end > start,
    'decision 151 annex §٧ could not be located. Without it every assertion below would ' +
      'compare against an empty map and pass on nothing.',
  ).toBe(true);
  const section = body.slice(start, end);

  const out = new Map<string, string>();
  for (const m of section.matchAll(/^\|([^\n]*)\|\s*$/gm)) {
    const cells = m[1].split('|').map((c) => c.trim());
    if (cells.length !== 2) continue;
    if (cells[0] === 'المفتاح' || /^-+:?$/.test(cells[0])) continue;
    out.set(cells[0].replace(/`/g, ''), cells[1]);
  }
  return out;
}

const RATIFIED = ratifiedText();

/** Ruling 3-أ's two keys — deferred past the demo by her own annex. */
const NOT_BUILT_YET = ['orgUnitNameEn', 'orgUnitNameAr'];

describe('owner decision 151 — the ratified strings', () => {
  it('§٧ carries exactly twenty-one keys — the floor for everything below', () => {
    /*
     * The non-vacuity floor. Every assertion below reads this map, and a parse that returned
     * four rows would let seventeen keys go unchecked while this file still printed green.
     */
    expect(
      [...RATIFIED.keys()].length,
      'decision 151 annex §٧ states the finished text of twenty-one keys. A different number ' +
        'here means this parser is reading the wrong table, not that she changed her mind.',
    ).toBe(21);
  });

  it('every §٧ key that this batch builds matches her text BYTE FOR BYTE', () => {
    const mismatched: string[] = [];
    for (const [key, want] of RATIFIED) {
      if (NOT_BUILT_YET.includes(key)) continue;
      const got = lookupOptional('AR', key);
      if (got !== want) mismatched.push(`${key}\n    ships: ${got}\n    annex: ${want}`);
    }
    expect(
      mismatched,
      'A shipped Arabic string differs from decision 151 annex §٧. Her paper is the authority: ' +
        'slice the span from it, never retype — and never edit the annex to match the code.',
    ).toEqual([]);
  });

  it('⛔ ruling 3-أ is NOT built, and that is pinned so a later batch cannot drift into it', () => {
    /*
     * Asserted in the direction that is TRUE TODAY. «(اختياري)» currently sits on the ARABIC
     * label and ruling 3-أ moves it to the English one — the Arabic name becoming mandatory.
     * Her annex defers it: «يُبنى بعد نسخة العرض».
     *
     * ⚠️ THIS TEST IS SUPPOSED TO FAIL THE DAY §٣ IS BUILT. That is not a defect: it is the
     * two rows above being moved out of NOT_BUILT_YET in the same commit, deliberately.
     */
    expect(lookupOptional('AR', 'orgUnitNameEn')).toBe('الاسم بالإنجليزية');
    expect(lookupOptional('AR', 'orgUnitNameAr')).toBe('الاسم بالعربية (اختياري)');
    for (const key of NOT_BUILT_YET) {
      expect(
        RATIFIED.get(key),
        `${key} must still be one of §٧'s rows — if it is not, ruling 3-أ moved and this ` +
          'deferral is describing something that no longer exists.',
      ).toBeDefined();
    }
  });

  it('⛔ `iassetIntro` KEEPS its ISO reference — the one clause citation ruling 2-أ spares', () => {
    /*
     * The exemption, asserted here as well as declared in `check:process-prefix`. The gate
     * proves no OTHER string carries a clause reference; this proves the spared one still
     * does. Each is useless without the other: a gate at budget zero would also be satisfied
     * by somebody deleting this sentence.
     */
    const body = readFileSync(ANNEX, 'utf8');
    const spared = /`iassetIntro`\s*«([^»]+)»/.exec(body);
    expect(
      spared,
      'Annex §٢ must name the span it spares. Without it this test would assert a string ' +
        'nobody ratified.',
    ).not.toBeNull();
    expect(lookupOptional('AR', 'iassetIntro') ?? '').toContain(spared?.[1] ?? '');
  });

  it('⛔ the three §٦ strings are NOT touched — she listed them as out of scope', () => {
    /*
     * §٦ names strings that contain «امتثال» and that ruling 4-أ deliberately does not reach:
     * the sign-in headline, a vowelled licence sentence, and an SLA hint. Without this, a
     * later sweep for «الامتثال» would read ruling 4-أ as a licence to change every instance.
     */
    expect(lookupOptional('AR', 'authBrandHeadline') ?? '').toContain('بامتثال');
    expect(lookupOptional('AR', 'rcStandingMayNotPractise') ?? '').toContain('الامتثالِ');
    expect(lookupOptional('AR', 'slaDashPauseReasonHint') ?? '').toContain('امتثال');
  });

  it('⛔ rows 8 and 9 say «مسؤول الالتزام» and are NOT aligned to the role name', () => {
    /*
     * Her §٨ ratifies this knowing it differs from the role name in the system, which is
     * «موظف الالتزام»: *«الصفّان ٨ و٩ يبقيان «مسؤول الالتزام» بكلمة الإدارة، وهي تعرف أن اسم
     * الدور في النظام «موظف الالتزام»»*. Pinned so a later consistency tidy-up cannot quietly
     * align them — the same struck-exception shape `rfqNewRefusalAct` already carries.
     */
    expect(lookupOptional('AR', 'smComplianceOfficerOnly')).toBe('مسؤول الالتزام فقط');
    expect(lookupOptional('AR', 'smNamesAreCheckedAgainstThe') ?? '').toContain(
      'مسؤول الالتزام',
    );
    for (const key of ['smComplianceOfficerOnly', 'smNamesAreCheckedAgainstThe']) {
      expect(lookupOptional('AR', key) ?? '').not.toContain('موظف الالتزام');
    }
  });
});
