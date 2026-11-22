import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional, type TranslationKey } from './translations';

/**
 * 🔴 OWNER DECISION 157 + THE REST OF DECISION 153 §٢ — EVERY STRING RE-SLICED FROM HER PAPERS.
 *
 * ## What this pins
 *
 * Message 51 §1 turned ~37 hard-coded English fragments on the demo path into dictionary keys.
 * Every Arabic value came out of one of two tables:
 *
 *   - `docs/decision-153-answer-sheet-3.md` §٢ — four-cell rows, `| # | الموضع | يُطبَع اليوم | النص |`
 *   - `docs/decision-157-answer-sheet-4.md` tables أ / ب / ج / د
 *
 * ## ⛔ NOTHING HERE IS RETYPED
 *
 * The expected strings are read out of her papers AT TEST TIME. A test holding its own copy of
 * her Arabic is a second home for it, free to agree with a dictionary that drifted the same way
 * — which is how a hand-spelled anchor drifted by one shadda on 2026-11-17 and reported zero
 * occurrences of a span plainly in the file.
 *
 * ## 🔴 AND THE ROW NUMBER ALONE IS NOT ENOUGH IN DECISION 157
 *
 * `decision-153.strings.test.ts` filters by CELL COUNT, because §١'s rulings table also carries a
 * row numbered ٣. That is not sufficient here: decision 157 carries a row numbered ٧ in table أ
 * (the policy checking line) AND a row numbered ٧ in table ج (the asset count), both four cells
 * wide. A whole-file search would pick whichever came first and pin the dictionary to the wrong
 * sentence while reporting a clean slice. So every lookup is SCOPED TO ITS SECTION as well.
 *
 * ## The one thing that is transformed rather than compared
 *
 * She writes a value slot as `{...}` with an Arabic word in it — «القسط المطلوب: {المبلغ}» — and
 * says so in both papers: «`{…}` موضع قيمة يضعها النظام». A slot NAME is engineering, not ratified
 * words, so it is mapped to the Latin param `translate()` substitutes. That mapping is applied
 * here and carries a NON-VACUITY FLOOR below, so it can never quietly become the identity
 * function and start asserting the un-mapped text.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const P153 = join(REPO, 'docs', 'decision-153-answer-sheet-3.md');
const P157 = join(REPO, 'docs', 'decision-157-answer-sheet-4.md');

/** Section headings, by their first character — her tables أ / ب / ج / د. */
const SEC_A = '### أ';
const SEC_B = '### ب';
const SEC_J = '### ج';
const SEC_D = '### د';
/** Decision 153 §٢ — «## ٢ — النصوص المصادَق عليها». */
const SEC_153 = '## ٢';

/** The body of one section of a paper, heading included, up to the next heading. */
function section(paper: string, heading: string): string {
  const body = readFileSync(paper, 'utf8');
  const at = body.indexOf(heading);
  expect(
    at,
    `${paper} must contain the heading ${heading} exactly once`,
  ).toBeGreaterThanOrEqual(0);
  expect(body.indexOf(heading, at + 1), `${heading} is not unique`).toBe(-1);
  const ends = [body.indexOf('\n### ', at + 1), body.indexOf('\n## ', at + 1)]
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  return ends.length > 0 ? body.slice(at, ends[0]) : body.slice(at);
}

/** One row of one table, by its id, with the cell count checked. */
function row(
  paper: string,
  heading: string,
  cells: number,
  id: string,
): string[] {
  const found = [...section(paper, heading).matchAll(/^\|([^\n]*)\|\s*$/gm)]
    .map((m) => m[1].split('|').map((c) => c.trim()))
    .filter((c) => c.length === cells && c[0] === id);
  expect(
    found,
    `${paper} ${heading} must carry exactly one ${cells}-cell row with id ${id} — ` +
      'if it does not, the comparison below is reading the wrong table and would pass ' +
      'against anything',
  ).toHaveLength(1);
  return found[0];
}

/**
 * Her slot names, mapped to the params `translate()` substitutes.
 *
 * Longest first: «{اسم الحالة}» must be tried before «{الحالة}», or the first would be left
 * holding a stray «اسم ». A wrong entry here cannot make a test pass — the mapped text simply
 * stops matching the dictionary and the comparison goes red.
 */
const SLOTS: readonly (readonly [string, string])[] = [
  ['{اسم الحالة}', '{status}'],
  ['{اسم الموظف}', '{name}'],
  ['{المبلغ}', '{amount}'],
  ['{التاريخ}', '{date}'],
  ['{العدد}', '{count}'],
  ['{الحالة}', '{status}'],
  ['{الاسم}', '{name}'],
  ['{اسمها}', '{name}'],
];

let slotsApplied = 0;

function withLatinSlots(text: string): string {
  let out = text;
  for (const [ar, latin] of SLOTS) {
    if (out.includes(ar)) slotsApplied += 1;
    out = out.split(ar).join(latin);
  }
  // No Arabic may survive inside a slot: that would mean her paper used a name this map does
  // not know, and the comparison below would fail with a confusing diff instead of here.
  for (const m of out.matchAll(/\{[^}]*\}/g)) {
    expect(
      /[؀-ۿ]/.test(m[0]),
      `an unmapped Arabic value slot survived: ${m[0]} in ${text}`,
    ).toBe(false);
  }
  return out;
}

/** key -> the cell its Arabic must equal, byte for byte. */
const FROM_153: readonly (readonly [TranslationKey, string])[] = [
  ['policySectionRequestedPremium', '٤'],
  ['policySectionInception', '٥'],
  ['policySectionScheduleOngoing', '٦'],
  ['policySectionReceiptAcknowledged', '٨'],
  ['endorsementCommissionReversalLabel', '٩-ب'],
  ['iprogdSumInsuredAtQuotation', '١٢'],
  ['claimDocRequiredMark', '١٣'],
  ['endorsementBasisProRata', '١٤-أ'],
  ['endorsementBasisShortPeriod', '١٤-ب'],
  ['naListUpdatedLabel', '١٥'],
  ['customerCrmIntro', '١٨'],
  ['usrSelect', '٢٠-أ'],
  ['usrSelect2', '٢٠-أ'],
  ['rcLineChoosePlaceholder', '٢٠-ب'],
];

const FROM_157_A: readonly (readonly [TranslationKey, string])[] = [
  ['policySectionCheckedBy', '٧'],
  ['rfqOpportunityStatusRefusal', '١٦'],
];

const FROM_157_B: readonly (readonly [TranslationKey, string])[] = [
  ['policySectionIssuedPremium', '٢-١'],
  ['policySectionExpiry', '٢-٢'],
  ['policySectionScheduleEffective', '٢-٣'],
  ['policySectionNamedPerils', '٢-٤'],
  ['policySectionExtensions', '٢-٥'],
  ['policySectionDeliveryRecipient', '٢-٦'],
  ['claimCardSettledMark', '٢-٧'],
  ['polCommOverrideApproved', '٢-٨'],
  ['polCommStatementAmountInline', '٢-٩'],
  ['naNewProfileSelectPlaceholder', '٢-١٠'],
  ['naReviewMarkReviewedButton', '٢-١١'],
  ['crateStatusClosed', '٢-١٣'],
];

const FROM_157_J: readonly (readonly [TranslationKey, string])[] = [
  ['policySectionPremiumVariance', '٣'],
  ['claimCardBrokerProcessed', '٥-أ'],
  ['claimCardSecondApproved', '٥-ب'],
  ['claimCardAwaitingSecondApprover', '٥-ج'],
  ['polCommOverridePendingApproval', '٦-أ'],
  ['polCommStatementMustEqual', '٦-ب'],
  ['iprogdAssetCountLabel', '٧'],
  ['iprogdNeedsAssessmentLabel', '٨'],
  ['naReviewReturnForChangesButton', '٩-أ'],
  ['naFormSaveDraftButton', '٩-ب'],
  ['naFormSaveQuestionnaireButton', '٩-ج'],
  ['acrCycleStartedMessage', '١٠'],
];

describe('owner decision 153 §٢ — the rows message 51 built', () => {
  it.each(FROM_153)('%s carries her text, byte for byte', (key, id) => {
    expect(lookupOptional('AR', key)).toBe(
      withLatinSlots(row(P153, SEC_153, 4, id)[3]),
    );
  });

  /*
   * NON-VACUITY for the slice itself: row ٧'s «يُطبَع اليوم» column must still describe the
   * defect — the internal id. If her table were re-numbered, this fails rather than silently
   * pinning some other row's text.
   */
  it('row ٧ is still the one about the id that was printed', () => {
    expect(row(P153, SEC_153, 4, '٧')[2]).toContain('Checked by');
  });

  it('row ١٨ removes the parenthetical rather than rewording the sentence', () => {
    const was = row(P153, SEC_153, 4, '١٨')[2];
    const now = row(P153, SEC_153, 4, '١٨')[3];
    expect(was).toContain('(');
    expect(now).not.toContain('(');
  });
});

describe('owner decision 157 — tables أ, ب and ج', () => {
  it.each(FROM_157_A)('%s carries her amended text, byte for byte', (key, id) => {
    expect(lookupOptional('AR', key)).toBe(
      withLatinSlots(row(P157, SEC_A, 4, id)[3]),
    );
  });

  it.each(FROM_157_B)('%s carries her text, byte for byte', (key, id) => {
    expect(lookupOptional('AR', key)).toBe(
      withLatinSlots(row(P157, SEC_B, 5, id)[3]),
    );
  });

  it.each(FROM_157_J)('%s carries her text, byte for byte', (key, id) => {
    expect(lookupOptional('AR', key)).toBe(
      withLatinSlots(row(P157, SEC_J, 4, id)[3]),
    );
  });

  /*
   * 🔴 THE REASON EVERY LOOKUP IS SCOPED TO A SECTION.
   *
   * Row ٧ exists in table أ (the policy checking line) and in table ج (the asset count), both
   * four cells wide. Cell-count filtering alone — which is what decision 153's test needs — would
   * pick whichever came first in the file and pin BOTH keys to it. This asserts they are
   * genuinely different rows, so the scoping cannot be quietly removed.
   */
  it('row ٧ means two different things in table أ and table ج', () => {
    const a = row(P157, SEC_A, 4, '٧')[3];
    const j = row(P157, SEC_J, 4, '٧')[3];
    expect(a).not.toBe(j);
    expect(lookupOptional('AR', 'policySectionCheckedBy')).toBe(
      withLatinSlots(a),
    );
    expect(lookupOptional('AR', 'iprogdAssetCountLabel')).toBe(
      withLatinSlots(j),
    );
  });

  /*
   * 🔴 RULING 1's WHOLE POINT. Decision 153 row ١٦ named the placement stage and the server
   * refuses in every status but two, so the sentence was false six ways. The amended one carries
   * a SLOT; the superseded one does not. Asserting the slot is what makes «the status names
   * itself» checkable rather than hoped for.
   */
  it('the RFQ refusal names the stage instead of asserting one', () => {
    const superseded = row(P157, SEC_A, 4, '١٦')[2];
    const amended = row(P157, SEC_A, 4, '١٦')[3];
    expect(superseded).not.toContain('{');
    expect(amended).toContain('{');
    expect(lookupOptional('AR', 'rfqOpportunityStatusRefusal')).toContain(
      '{status}',
    );
  });
});

describe('owner decision 157 table د — the dual-control sentence', () => {
  it('carries «ستّ عشرة» and not one other word moved', () => {
    const r = [...section(P157, SEC_D).matchAll(/^\|([^\n]*)\|\s*$/gm)]
      .map((m) => m[1].split('|').map((c) => c.trim()))
      .filter((c) => c.length === 4 && c[0].includes('dutySegIntro'));
    expect(r, 'table د must carry exactly one dutySegIntro row').toHaveLength(1);
    const [, , was, now] = r[0];

    const sentence = lookupOptional('AR', 'dutySegIntro');
    expect(sentence).toContain(now);
    expect(sentence).not.toContain(was);

    /*
     * «ولا تتغيّر كلمة أخرى في الجملة». Putting the old span back must reproduce what shipped
     * before this batch — which is a stronger claim than "the new span is present", and the only
     * one that catches a reword smuggled in beside the number.
     *
     * ⚠️ The two spans are the SAME LENGTH, so a length check proves nothing. This compares
     * content.
     */
    expect(was).not.toBe(now);
    expect(sentence?.split(now).join(was)).toBe(
      'خمس عشرة عملية في هذا النظام لا يمكن أن ينفّذها شخص واحد: من يسجّل الإجراء لا يمكن أن يكون من يعتمده. هذه قائمة بها، ومعها ما إذا كان مكتبك يملك شخصاً ثانياً لكل منها اليوم.',
    );
  });
});

describe('the value-slot mapping is not the identity function', () => {
  /*
   * A NON-VACUITY FLOOR. Every assertion above runs her text through `withLatinSlots`. If that
   * map were emptied — or her slot names changed — the transform would silently become the
   * identity and every comparison would start asserting the un-mapped Arabic, which would fail
   * loudly. But the reverse is the dangerous direction: a FUTURE batch that drops the mapping
   * for strings that no longer carry slots would leave this suite passing while proving less.
   */
  it('applied a slot to at least a dozen of her strings', () => {
    expect(slotsApplied).toBeGreaterThanOrEqual(12);
  });
});

describe('⛔ what decision 157 carries to module 15, and what decision 154 suspended', () => {
  /*
   * The eleven KYC hold sentences are «بعد العرض، مع مديول ١٥» (ruling 12) and the consent card
   * is suspended by decision 154. Both are ASSERTED absent rather than left to discipline: a
   * later batch sweeping «the rest of the English on the demo path» would otherwise walk
   * straight into them.
   */
  it('no key was minted for a screening-hold reason', () => {
    for (const key of [
      'kycHoldNoScreening',
      'kycHoldScreeningIncomplete',
      'kycHoldPossibleMatch',
    ] as const) {
      expect(
        lookupOptional('AR', key as unknown as TranslationKey),
        `${key} must not exist — ruling 12 carries those eleven sentences to module 15`,
      ).toBeUndefined();
    }
  });

  it('the consent card keeps the text decision 154 suspended', () => {
    expect(
      lookupOptional('AR', 'consentGrantedAt' as unknown as TranslationKey),
    ).toBeUndefined();
  });
});
