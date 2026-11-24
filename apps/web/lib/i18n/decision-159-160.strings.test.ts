import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 DECISIONS 159 AND 160 — THE LICENCE SCREEN AFTER THE DECLARATION.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Decision 159 changes exactly two spans and borrows two sentences that already ship; decision
 * 160 changes NO words at all and moves one condition. Every Arabic span here is SLICED from her
 * own papers at test time and compared byte for byte — a test holding its own copy of her Arabic
 * would be a second home for it, and the first reword would leave the copy asserting the old
 * text while the screen shipped the new one.
 *
 * ## THE TWO DIRECTIONS, BOTH ASSERTED
 *
 * A presence check alone passes against a string carrying BOTH the old span and the new one, so
 * each row asserts the «صار» present AND the «كان» gone. And the whole value is asserted equal
 * to her own «النصّ الكامل بعد القرار» line, which is what stops a second word drifting beside
 * the one that was meant to move.
 *
 * ## AND THE BORROWED SENTENCES ARE PINNED TO THEIR SOURCE, NOT TO A LITERAL
 *
 * Ruling 3 approves «الجملة الشغّالة» — `dpoAssignAcknowledgedOn` — and ruling 4 approves
 * `a15dEvidenceLabel`. Both get their OWN key with the same text (decision 157 ruling 2), so the
 * assertion is key-to-key: `rcRenewalDeclaredBy` must equal `dpoAssignAcknowledgedOn` in both
 * halves, for ever. ⛔ Not a copy of the words into this file, which would let the pair drift
 * apart while the test stayed green.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const D159 = join(REPO, 'docs', 'decision-159-licence-screen-sentences.md');
const D160 = join(REPO, 'docs', 'decision-160-after-the-declaration.md');

/** Her two «كان | صار» rows, sliced by the span each is about rather than by position. */
function spanRows(): { was: string; now: string }[] {
  const paper = readFileSync(D159, 'utf8');
  const rows = [...paper.matchAll(/^\| (.+?) \| (.+?) \|$/gm)]
    .map((m) => ({ was: m[1], now: m[2] }))
    .filter(
      (r) => r.was.includes('قُدّم في موعده') || r.was.includes('يَرفعُ المنعَ'),
    );
  expect(
    rows.length,
    'decision 159 no longer carries both «كان | صار» rows — the slice source moved',
  ).toBe(2);
  return rows;
}

/** Her own full text for each of the two keys, in paper order. */
function fullTexts(): string[] {
  const paper = readFileSync(D159, 'utf8');
  const texts = [
    ...paper.matchAll(/^\*\*النصّ الكامل بعد القرار:\*\* «(.+?)»\s*$/gm),
  ].map((m) => m[1]);
  expect(
    texts.length,
    'decision 159 no longer carries both «النصّ الكامل بعد القرار» lines',
  ).toBe(2);
  return texts;
}

const AR = (key: string) => lookupOptional('AR', key);
const EN = (key: string) => lookupOptional('EN', key);

describe('decision 159 — the two ratified spans', () => {
  it('every span is sliced from her paper and is non-empty', () => {
    for (const { was, now } of spanRows()) {
      expect(was.length).toBeGreaterThan(10);
      expect(now.length).toBeGreaterThan(was.length);
      // NON-VACUITY: a row whose two halves were equal would make every assertion below
      // trivially true, and the comparison would pass against a dictionary nobody had changed.
      expect(now).not.toBe(was);
    }
  });

  it('§1 — `rcValidPendingRenewalDecision` carries «بإثباته وسُجِّل الإقرار»', () => {
    const [row] = spanRows().filter((r) => r.was.includes('قُدّم في موعده'));
    const value = AR('rcValidPendingRenewalDecision');
    expect(value).toContain(row.now);
    // The OLD span is gone. Without this the test passes against a value carrying both.
    expect(value).not.toContain(`${row.was} إلى حين`);
    expect(value).toBe(fullTexts()[0]);
  });

  it('§2 — `rcNoticeFiled` names the declaration as what lifts the block', () => {
    const [row] = spanRows().filter((r) => r.was.includes('يَرفعُ المنعَ'));
    const value = AR('rcNoticeFiled');
    expect(value).toContain(row.now);
    expect(value).not.toContain(row.was);
    expect(value).toBe(fullTexts()[1]);
  });

  it('⛔ neither English half changed — they are not ruled, and ONE IS NOW AN EMPTY CELL', () => {
    /*
     * Decision 159's own words: «الواجهة الإنجليزية: كلماتها كما هي». The CONDITION moves with
     * the Arabic (a condition is not a word) and is asserted in Playwright, not here.
     *
     * ⚠️ AND THE SECOND HALF IS REPORTED, NOT FIXED. The Arabic `rcNoticeFiled` now names the
     * declaration as one of the two things that lift the block; the English still names only
     * the new term and its certificate, which is the pre-159 text and is what her ruling leaves
     * standing. Pinned in the NOT-TOUCHED direction, so a later batch has to move it
     * deliberately rather than «finishing the sweep» on a half she did not rule.
     */
    expect(EN('rcValidPendingRenewalDecision')).toBe(
      "This term's printed expiry has passed, and the licence is treated as still valid " +
        "because the renewal application was filed on time, until the CBJ's decision issues. " +
        'This is an internal decision and rests on no provision of Instructions No. 9 of 2026.',
    );
    expect(EN('rcNoticeFiled')).toBe(
      'A renewal application is on record. It does NOT lift the block and it does not stop ' +
        'this notice: filing is not a decision, and what lifts the block is recording the new ' +
        'licence term together with its certificate.',
    );
    // The empty cell, stated as an assertion: the English names no declaration.
    expect(EN('rcNoticeFiled')).not.toContain('declaration');
  });
});

describe('decision 159 ruling 3 — who declared, and when', () => {
  it('`rcRenewalDeclaredBy` is `dpoAssignAcknowledgedOn`, in both halves', () => {
    // KEY TO KEY, never to a literal. «موافقة على الجملة الشغّالة» approves THAT sentence, so
    // the day its words move the two must move together or this fails.
    expect(AR('rcRenewalDeclaredBy')).toBe(AR('dpoAssignAcknowledgedOn'));
    expect(EN('rcRenewalDeclaredBy')).toBe(EN('dpoAssignAcknowledgedOn'));
  });

  it('it is its OWN key and not a second render of that one', () => {
    // Decision 157 ruling 2. Equal TEXT, different KEY — so a later reword of the DPO card
    // cannot silently move the licence screen, which is the failure the ruling describes.
    expect(AR('rcRenewalDeclaredBy')).toBeDefined();
    expect(AR('dpoAssignAcknowledgedOn')).toBeDefined();
  });

  it('both placeholders survive, so the name and the date have somewhere to land', () => {
    for (const half of [AR('rcRenewalDeclaredBy'), EN('rcRenewalDeclaredBy')]) {
      expect(half).toContain('{who}');
      expect(half).toContain('{when}');
    }
  });
});

describe('decision 159 ruling 4 — the attached message is named', () => {
  it('the evidence label is the creation window’s own, unchanged', () => {
    const paper = readFileSync(D159, 'utf8');
    // Her table names the key AND quotes the span, so the slice is the span in her own row.
    const row = [...paper.matchAll(/^\| ومعها \|/gm)];
    expect(row.length, 'decision 159 ruling 4’s «ومعها» row moved').toBe(1);
    expect(paper).toContain(AR('a15dEvidenceLabel') as string);
  });
});

describe('decision 160 — a condition, and not one word', () => {
  it('ruling 1 changes no word of `rcNoticeFiled`', () => {
    // 160's own «ما لا يتغيّر» section names 159's text. So the sentence this batch wrote for
    // 159 §2 must still be exactly what ships — 160 only decides WHEN it is rendered.
    expect(AR('rcNoticeFiled')).toBe(fullTexts()[1]);
  });

  it('her paper states the condition in the two words the render reads', () => {
    const paper = readFileSync(D160, 'utf8');
    // The ruling is about the UNDER_STUDY state («قيدَ التجديد») after the declaration. The
    // render is asserted in Playwright; what is asserted here is that the paper still says so,
    // so a reader who finds this test can find the sentence it implements.
    expect(paper).toContain('قيدَ التجديد');
    expect(paper).toContain('شرط ظهور فقط؛ لا تتغيّر كلمة فيها');
  });

  it('ruling 2 — the Arabic bell sentence carries no route and no Latin word', () => {
    const paper = readFileSync(D160, 'utf8');
    expect(paper).toContain(
      'الجملة العربية لا تحمل عنوان خادم ولا رمزاً ولا كلمة لاتينية',
    );
    // The 234-code assertion lives in `new-permission-sentence.test.ts`, beside the function
    // that composes the sentence. This one proves the paper it implements has not moved.
    expect(paper).toContain('لا تُعرَض عبارة «تتحكّم في:»');
  });
});
