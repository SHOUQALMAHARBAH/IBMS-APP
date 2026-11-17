import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 128's SCREEN STRINGS, RE-SLICED FROM DECISIONS 133 AND 136 AND COMPARED.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Decision 133 §٢ ratifies SEVEN strings for the renewal-under-study screen, and decision 136(ب)
 * ratifies the sentence shown when issuance is refused because nobody has declared yet. Every one
 * of them is HERS: sliced from her own tables by script and never retyped here or in the
 * dictionary. A hand-edit fails with the source named.
 *
 * ## THE TRAP THIS FILE IS SHAPED AROUND
 *
 * ⚠️ HER STAMP CELL CARRIES THREE «…» SPANS AND THE STAMP IS THE FIRST. The other two are the
 * words she FORBIDS on this state — «ساري» and «حكماً» — written into the same cell as the
 * prohibition. A slice reaching for the last span, or for «the quoted bit», would put a forbidden
 * word onto the record AS its stamp, and the comparison would still pass against a dictionary
 * that had made the identical mistake. So all three spans are asserted BY POSITION, and the two
 * forbidden words are asserted absent from the shipped stamp.
 *
 * This is the same shape as `article-15-d.strings.test.ts`'s decision-143 slice, where the first
 * span is the MARK and the label is the second.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const D133 = join(REPO, 'docs', 'decision-133-strings-ratified.md');
const D136 = join(
  REPO,
  'docs',
  'decision-136-renewal-stamp-and-refusal-sentence.md',
);

/**
 * Her decision-128 table, by site cell, each cell's «…» spans in order.
 *
 * ⚠️ SLICED BY INDEX RATHER THAN BY ONE REGEX OVER THE WHOLE FILE. Decision 133 ratifies FOUR
 * tables and three of them carry rows whose site cells read similarly; a file-wide match would
 * take whichever came first. The section is found by heading and the rows are read inside it.
 */
function ratifiedSpans(): Record<string, string[]> {
  const lines = readFileSync(D133, 'utf8').split(/\r?\n/);
  const heads = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.startsWith('### '));
  const start = heads.filter(({ line }) => line.includes('١٢٨')).at(-1);
  expect(
    start,
    'decision 133 no longer has a «القرار ١٢٨» section — the slice source moved',
  ).toBeDefined();
  const next = heads.find(({ i }) => i > start!.i);
  const out: Record<string, string[]> = {};
  for (const line of lines.slice(start!.i + 1, next ? next.i : undefined)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 2 || /^-+$/.test(cells[0])) continue;
    out[cells[0]] = [...cells[1].matchAll(/«(.+?)»/g)].map((m) => m[1]);
  }
  return out;
}

/** Decision 136's ruling (ب) — the refusal sentence, the last quoted span on its own row. */
function ratifiedRefusal(): string {
  const line = readFileSync(D136, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('|'))
    .find((l) => l.includes('الترخيص قيدَ التجديد'));
  expect(
    line,
    'decision 136 no longer carries the refusal sentence — the slice source moved',
  ).toBeDefined();
  const spans = [...line!.matchAll(/«(.+?)»/g)].map((m) => m[1]);
  expect(spans.length, 'the refusal row carries no quoted sentence').toBeGreaterThan(0);
  return spans.at(-1)!;
}

function ar(key: string): string {
  const value = lookupOptional('AR', key);
  expect(value, `${key} has no Arabic value at all`).toBeTruthy();
  return value as string;
}

describe('OWNER DECISION 133 — decision 128’s seven strings are hers, byte for byte', () => {
  const spans = ratifiedSpans();

  it('slices her whole table, non-vacuously', () => {
    /*
     * The floor every comparison below rests on. A drifted heading or row matcher would make
     * each assertion compare undefined to undefined — the clean-nothing shape this repository
     * has paid for repeatedly.
     */
    expect(Object.keys(spans).sort()).toEqual(
      [
        // Her HEADING row, kept in the expectation rather than filtered out: it is free proof
        // that the table really parsed, and a changed heading is a changed table.
        'الموضع',
        'الختم على وثيقة صدرت بهذه الحالة',
        'خانة ملف الإثبات',
        'خانة التاريخ',
        'خانة الرقم',
        'إقرار المدير (مرة لكل فترة ترخيص)',
        'حالة الترخيص',
        'نوعا فعل الجهة الرقابية الجديدان',
      ].sort(),
    );
  });

  it('🔴 the STAMP is the FIRST span, and the other two are the words she FORBIDS', () => {
    const cell = spans['الختم على وثيقة صدرت بهذه الحالة'];
    expect(
      cell,
      'her stamp cell no longer carries the stamp AND the two forbidden words, in that order',
    ).toHaveLength(3);
    expect(cell[1], 'the second span is a FORBIDDEN word, not the stamp').toBe(
      'ساري',
    );
    expect(cell[2], 'the third span is a FORBIDDEN word, not the stamp').toBe(
      'حكماً',
    );
    expect(
      ar('rcRenewalStamp'),
      'the renewal stamp is not byte-identical to OWNER DECISION 133. It is HER sentence: ' +
        're-slice it from docs/decision-133-strings-ratified.md rather than editing it here.',
    ).toBe(cell[0]);
  });

  it('⛔ and the shipped stamp contains NEITHER forbidden word', () => {
    /*
     * Not decoration, and not implied by the comparison above. Her prohibition is about what the
     * screen may say of this state, and the two words sit one line from the stamp in her own
     * cell — which is exactly where a later edit reaching for «the status word» would find them.
     */
    const stamp = ar('rcRenewalStamp');
    expect(stamp.includes('ساري')).toBe(false);
    expect(stamp.includes('حكماً')).toBe(false);
  });

  it.each([
    ['rcRenewalProofLabel', 'خانة ملف الإثبات'],
    ['rcRenewalRequestedAtLabel', 'خانة التاريخ'],
    ['rcRenewalReferenceLabel', 'خانة الرقم'],
    ['rcRenewalDeclarationSentence', 'إقرار المدير (مرة لكل فترة ترخيص)'],
  ])('%s is exactly what she ratified', (key, site) => {
    expect(
      ar(key),
      `${key} is not byte-identical to OWNER DECISION 133's own table. Re-slice it rather ` +
        'than editing it here.',
    ).toBe(spans[site][0]);
  });

  it('the two new regulatory-action kinds are hers, and in her order', () => {
    const cell = spans['نوعا فعل الجهة الرقابية الجديدان'];
    expect(cell, 'her cell no longer carries exactly two kinds').toHaveLength(2);
    expect(ar('rcActKindDeficiencyNotice')).toBe(cell[0]);
    expect(ar('rcActKindRenewalRefusal')).toBe(cell[1]);
  });

  it('the SEVENTH string was already shipping, and she marked it so', () => {
    /*
     * «قيدَ التجديد» is the licence status word and it shipped before this decision; her own row
     * says «شغّالة أصلاً». It is asserted here rather than re-added, because adding a second key
     * carrying it would be the «التعديلات»/«الملحقات» divergence class — one fact, two homes.
     */
    expect(ar('rcStandingRenewalPending')).toBe(spans['حالة الترخيص'][0]);
  });

  it.each([
    'rcRenewalStamp',
    'rcRenewalProofLabel',
    'rcRenewalRequestedAtLabel',
    'rcRenewalReferenceLabel',
    'rcRenewalDeclarationSentence',
    'rcActKindDeficiencyNotice',
    'rcActKindRenewalRefusal',
  ])('%s has an English side, because the screen is bilingual', (key) => {
    expect(lookupOptional('EN', key)).toBeTruthy();
  });
});

describe('OWNER DECISION 136(ب) — the refusal sentence is hers', () => {
  it('is byte-identical to her ruling', () => {
    expect(
      ar('rcRenewalAwaitingDeclaration'),
      'the awaiting-declaration sentence is not byte-identical to OWNER DECISION 136(ب). ' +
        're-slice it from docs/decision-136-...md rather than editing it here.',
    ).toBe(ratifiedRefusal());
  });

  it('⛔ and it does NOT tell the employee the licence has expired', () => {
    /*
     * The load-bearing half of her ruling. What is missing is ONE act by the office's own
     * administrator; a sentence reading as «your licence is gone» would send the employee to the
     * Central Bank instead of down the corridor, on the one screen where they are trying to work.
     */
    const sentence = ar('rcRenewalAwaitingDeclaration');
    expect(sentence).toContain('قيدَ التجديد');
    expect(sentence).toContain('راجع مسؤول النظام');
    expect(sentence.includes('منتهٍ')).toBe(false);
  });

  it('and the api sends the SAME sentence, from its own constant', () => {
    /*
     * 🔴 THE SENTENCE HAS TWO HOMES BY NECESSITY AND THEY ARE PINNED TOGETHER.
     *
     * The refusal is raised by `LicenseGateService` — the api answers it, because the gate is
     * what knows the office may not issue — and the screen also shows it in place. Two copies is
     * one more than this repository likes; the alternative was the api sending a KEY the web
     * resolves, which every other refusal on this path does NOT do, so the sentence would be the
     * only one of its kind. Pinned instead: a drift in either home fails here by name.
     */
    const gate = readFileSync(
      join(
        REPO,
        'apps',
        'api',
        'src',
        'modules',
        'compliance-risk',
        'license-gate.service.ts',
      ),
      'utf8',
    );
    expect(
      gate,
      'the api no longer carries OWNER DECISION 136(ب)’s sentence verbatim',
    ).toContain(ratifiedRefusal());
  });
});
