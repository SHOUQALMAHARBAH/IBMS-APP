import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupOptional } from './translations';

/**
 * 🔴 DECISION 167/13 — THE FINANCE INVOICE SCREEN'S WORDS, RE-SLICED FROM HER PAPER AT TEST TIME.
 *
 * «شاشة «الفواتير» للمالية فيها «تسجيل قبض» و«تسجيل توريد» بصلاحيات المالية الموجودة، بلا فتح
 * الفرص» — row ١٦٧/١٣ of `docs/decision-167-walk-answers-17.md`.
 *
 * ⛔ NOTHING HERE IS RETYPED. The three words she gave are read out of her paper at test time,
 * because a test holding its own copy of her Arabic is a second home for it — free to agree with a
 * dictionary that drifted the same way. The row is located by its own number and the words by her
 * own «…» guillemets, so a reflow of the table cannot move what is sliced.
 *
 * And every OTHER word on that screen is compared byte-for-byte against the shipping key it came
 * from. ⛔ They are their own keys rather than a second render of those (decision 157 ruling 2):
 * one key serving two screens is one key that cannot move, so nothing but a test keeps them equal.
 */

const AR = (key: string): string | undefined => lookupOptional('AR', key);
const EN = (key: string): string | undefined => lookupOptional('EN', key);

const DECISION = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'decision-167-walk-answers-17.md',
);

/** The three words inside row ١٦٧/١٣'s own guillemets, in her order. */
function herWords(): string[] {
  const paper = readFileSync(DECISION, 'utf8');
  const rows = paper.split('\n').filter((l) => l.startsWith('| ١٦٧/١٣ |'));
  expect(rows, 'row ١٦٧/١٣ was not found in her paper').toHaveLength(1);
  return [...rows[0].matchAll(/«([^»]+)»/g)].map((m) => m[1]);
}

describe('decision 167/13 — the three words are hers, byte for byte', () => {
  it('her row carries exactly three quoted words, in this order', () => {
    /*
     * NON-VACUITY FIRST, and it is the half that matters: every assertion below indexes into this
     * array, so a reworded row that happened to quote two words would make them compare against
     * `undefined` — and `undefined === undefined` passes.
     */
    expect(herWords()).toEqual(['الفواتير', 'تسجيل قبض', 'تسجيل توريد']);
  });

  it('the screen title is her «الفواتير»', () => {
    expect(AR('invHeading')).toBe(herWords()[0]);
  });

  it('the receipt button is her «تسجيل قبض»', () => {
    expect(AR('invRecordReceiptButton')).toBe(herWords()[1]);
  });

  it('the remittance button is her «تسجيل توريد»', () => {
    expect(AR('invRecordRemittanceButton')).toBe(herWords()[2]);
  });

  it('the nav label is her «الفواتير» too — the same word, its own key', () => {
    /* ⛔ Its own key rather than a second render of `invHeading`: a nav label and a page title are
     * two sites (decision 157 ruling 2), so nothing but this keeps them equal. */
    expect(AR('navInvoices')).toBe(herWords()[0]);
    expect(AR('navInvoices')).toBe(AR('invHeading'));
  });

  it('⛔ and neither button carries a full stop she did not write', () => {
    /*
     * The decision-145 lesson, and decision 164 paid for it again: «تم إنشاء الدور بنجاح» carries
     * no stop where its sibling on the same screen has one, and appending one «for consistency»
     * edits ratified text.
     */
    expect(AR('invRecordReceiptButton')?.endsWith('.')).toBe(false);
    expect(AR('invRecordRemittanceButton')?.endsWith('.')).toBe(false);
  });
});

describe('decision 167/13 — every other word is a shipping one, in its own key', () => {
  it.each([
    ['invColCustomer', 'caColClient'],
    ['invColPolicy', 'policyPolicyNumberLabel'],
    ['invColInsurer', 'iaColInsurer'],
    ['invColTotal', 'financeTotalLabel'],
    ['invColCollected', 'financeCollectedLabel'],
    ['invColRemitted', 'financeRemittedLabel'],
    ['invColStatus', 'financeStatusLabel'],
    ['invColDue', 'financeDueDateLabel'],
  ])('%s carries %s byte for byte, in both halves', (mine, source) => {
    // NON-VACUITY FIRST: a typo in either key name makes both sides `undefined`, and
    // `undefined === undefined` passes — the shape of a test that proves nothing.
    expect(AR(source), `${source} has no Arabic value`).toBeTruthy();
    expect(EN(source), `${source} has no English value`).toBeTruthy();
    expect(AR(mine)).toBe(AR(source));
    expect(EN(mine)).toBe(EN(source));
  });

  it('⚠️ and the ENGLISH title and buttons are NOT ruled — they are the nearest shipping English', () => {
    /*
     * Decision 167/13 rules the ARABIC. Her paper gives no English, so these take the English of
     * the surface they sit on, and that is an EMPTY CELL rather than a decision: she may reword any
     * of the three in one line.
     *
     * Asserted so the next session does not mistake them for ratified text.
     */
    expect(EN('invHeading')).toBe('Invoices');
    expect(EN('invRecordReceiptButton')).toBe('Record a receipt');
    expect(EN('invRecordRemittanceButton')).toBe('Record a remittance');
  });
});
