import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 153 §٢ ROW ٣ — THE DECLARATION BUTTON, RE-SLICED FROM HER PAPER.
 *
 * ## What was wrong, measured on her second demo walk (§T1)
 *
 * `regulatory-compliance/page.tsx` renders `rcRecordRenewalButton` — «تسجيل تقديم طلب التجديد»
 * — on TWO different controls: the one that FILES the renewal application (`:719`,
 * `submitRenewalRequest`) and the one that records the standing DECLARATION (`:756`,
 * `submitRenewalDeclaration`). Two acts, one name, and only one of them was named correctly:
 * declaring that no refusal and no deficiency notice has arrived is not filing an application.
 *
 * ⟶ Her ruling: the declaration button is **«تسجيل الإقرار»**, and the filing control keeps
 *   what it has. So the declaration takes its OWN key — one key cannot name two acts, which is
 *   the shape decision 152 already made this repository write down for `oppListRefusalAct`.
 *
 * ## ⛔ NOTHING HERE IS RETYPED
 *
 * The expected string is read out of `docs/decision-153-answer-sheet-3.md` AT TEST TIME. A test
 * holding its own copy of her Arabic is a second home for it, free to agree with a dictionary
 * that drifted the same way — which is how a hand-spelled anchor drifted by one shadda on
 * 2026-11-17 and reported zero occurrences of a span plainly in the file.
 *
 * ## ⛔ AND ROW ١٩ IS WITHHELD — OWNER DECISION 154
 *
 * §٢ carries twenty rows. Row ١٩ (the consent card's «Granted {date} ({version})») is SUSPENDED
 * by her own §٣, one minute after she approved it: «لحظة … الموافقة لازم تيجي من العميل مش انا
 * اتنبأ انه هو موافق عليها». Decision 154 replaces it and belongs to module 11, after the demo.
 * That absence is ASSERTED below rather than left to discipline, because a later batch sweeping
 * «the rest of §٢'s table» would otherwise walk straight into it.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const PAPER = join(REPO, 'docs', 'decision-153-answer-sheet-3.md');

/**
 * One row of §٢'s five-column table, by its number.
 *
 * ⚠️ KEYED ON THE ROW NUMBER, NOT ON A LINE. Her §٣ was appended BELOW this table on the same
 * day she wrote it, so every line under §٢ has already moved once; and she appends addenda to
 * her own papers routinely. A line-keyed slicer would cut the wrong cell and still report a
 * clean slice.
 */
function ratifiedRow(number: string): { shownToday: string; text: string } {
  const body = readFileSync(PAPER, 'utf8');
  const rows = [...body.matchAll(/^\|([^\n]*)\|\s*$/gm)]
    .map((m) => m[1].split('|').map((c) => c.trim()))
    /*
     * FOUR cells — `| # | الموضع | يُطبَع اليوم | النص |`. The length is part of the filter and
     * not incidental: §١'s RULINGS table in the same paper also carries a row numbered ٣ («زرّ
     * الإقرار بالتجديد اسمه «تسجيل الإقرار».»), with two cells. Keying on the number alone
     * would pick whichever came first.
     */
    .filter((cells) => cells.length === 4 && cells[0] === number);
  expect(
    rows,
    `decision 153 §٢ must carry exactly one row numbered ${number} — if it does not, the ` +
      'comparison below is reading the wrong table and would pass against anything',
  ).toHaveLength(1);
  return { shownToday: rows[0][2], text: rows[0][3] };
}

describe('owner decision 153 §٢', () => {
  it('the declaration button carries her word, byte for byte', () => {
    expect(lookupOptional('AR', 'rcRecordDeclarationButton')).toBe(
      ratifiedRow('٣').text,
    );
  });

  it('and the row it answers is the one that names this screen and this line', () => {
    // NON-VACUITY for the slice itself: row ٣'s «يُطبَع اليوم» column must still hold the label
    // that is being replaced. If her table were re-numbered, this fails rather than silently
    // pinning the dictionary to some other row's text.
    const row = ratifiedRow('٣');
    // Her «يُطبَع اليوم» cell quotes the label in guillemets; the dictionary value is the bare
    // span. Compared on the span rather than by stripping her punctuation out of the paper.
    expect(row.shownToday).toContain(
      lookupOptional('AR', 'rcRecordRenewalButton') as string,
    );
  });

  it('🔴 the FILING control keeps its own label — one key cannot name two acts', () => {
    const filing = lookupOptional('AR', 'rcRecordRenewalButton');
    const declaring = lookupOptional('AR', 'rcRecordDeclarationButton');
    expect(filing).toBe('تسجيل تقديم طلب التجديد');
    expect(declaring).not.toBe(filing);
    /*
     * NON-VACUOUS BY ITS OVERLAP: both labels open with «تسجيل», so an assertion that only
     * looked for that word would pass against the old state where one key served both. This
     * pins the difference rather than the shared prefix.
     */
    expect(declaring).toContain('تسجيل');
    expect(filing).toContain('تسجيل');
  });

  it('both halves of the new key exist, so neither language renders the key itself', () => {
    expect(lookupOptional('AR', 'rcRecordDeclarationButton')).toBeTruthy();
    expect(lookupOptional('EN', 'rcRecordDeclarationButton')).toBeTruthy();
  });

  /*
   * ⛔ OWNER DECISION 154 — ROW ١٩ IS NOT BUILT, AND THE ABSENCE IS THE ASSERTION.
   *
   * Decision 154 («كيف تُؤخَذ موافقة العميل») replaces decision 153's item 19 outright: the
   * system displays the approved consent text, the employee ticks two separate boxes, picks a
   * channel, and the system records the date, the employee, the purpose and the version shown.
   * It is module 11's, after the demo.
   *
   * So the consent card must still print what it prints today. ⛔ Nobody touches the
   * consent-text-version field or the consent card until that decision is built.
   */
  it('⛔ decision 154 — row ١٩ is withheld, and no key carries its text', () => {
    const row = ratifiedRow('١٩');
    expect(
      row.text,
      'row ١٩ no longer carries its suspension marker — if the owner has lifted it, decision ' +
        '154 is what governs the consent card and this test is what has to be rewritten',
    ).toContain('موقوف');
    // And nothing in the product has quietly implemented it: the paper's own «يُطبَع اليوم»
    // cell for that row is the English string the consent card still shows.
    expect(row.shownToday).toContain('Granted');
  });
});
