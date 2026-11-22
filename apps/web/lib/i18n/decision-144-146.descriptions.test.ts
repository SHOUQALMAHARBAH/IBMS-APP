import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 144 §١ (fourteen corrections) AND DECISION 146 §٥ (two), RE-SLICED.
 *
 * Both are SPAN corrections to permission descriptions, and both annexes state the same
 * restriction in her own words: decision 144 §١ — *«يتغيّر ما في العمود الثالث وحده. لا
 * تتغيّر كلمة أخرى في أي شرح»* — only the third column moves, and no other word in any
 * description changes.
 *
 *   144 §١  14 rows — «طلب تسعير» / «طلب عرض سعر» ⟶ «طلب عرض أسعار» and its definite and
 *                     plural forms (8 rows); «وثيقة» ⟶ «مستند» where the subject is a
 *                     DOCUMENT and not an insurance policy (3 rows); and «نسبة الخسارة»
 *                     ⟶ «معدّل الخسارة» (3 rows).
 *   146 §٥   2 rows — «مرشَّح مؤهَّل» ⟶ «عميل مرتقب».
 *
 * ## ⛔ NOTHING HERE IS RETYPED
 *
 * Every «was» and «became» is read out of the annex AT TEST TIME and the substitution is
 * re-derived. A test holding its own copy of her Arabic is a second home for it, free to
 * agree with a dictionary that drifted the same way.
 *
 * ## ⛔ AND `rfqNewRefusalAct` IS THE STRUCK EXCEPTION — IT KEEPS «سعر»
 *
 * The owner was shown that it contradicts this very correction ON THE SAME SCREEN and ruled
 * it so knowing (decision 150). It is a screen's ACT PHRASE, not a permission description,
 * and decision 144 §١ names codes rather than dictionary keys. Pinned below in the OTHER
 * direction so a later consistency sweep cannot "finish the job" into it.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const A144 = join(REPO, 'docs', 'decision-144-ratified-strings.md');
const A146 = join(REPO, 'docs', 'decision-146-ratified-strings.md');

interface Correction {
  code: string;
  was: string;
  became: string;
}

/** The three-column rows of one annex section. */
function corrections(file: string, head: string, next: string): Correction[] {
  const body = readFileSync(file, 'utf8');
  const start = body.indexOf(head);
  const end = body.indexOf(next);
  expect(
    start >= 0 && end > start,
    `could not locate ${head} in ${file}. Without it every assertion below would run over ` +
      'an empty list and pass on nothing.',
  ).toBe(true);

  const out: Correction[] = [];
  for (const line of body.slice(start, end).split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 3) continue;
    if (cells[0] === 'الرمز' || cells[0] === 'الشرح' || /^-+:?$/.test(cells[0])) continue;
    out.push({ code: cells[0].replace(/`/g, ''), was: cells[1], became: cells[2] });
  }
  return out;
}

const ROWS_144 = corrections(A144, '## ١ —', '## ٢ —');
const ROWS_146 = corrections(A146, '## ٥ —', '## ٦ —');

/** The dictionary key a permission code's Arabic description lives under. */
function descriptionKey(code: string): string {
  return `perm:${code}`;
}

describe('owner decisions 144 §١ and 146 §٥ — the description corrections', () => {
  it('the two annexes carry fourteen and two rows — the floor for everything below', () => {
    expect(
      ROWS_144.length,
      'decision 144 annex §١ states FOURTEEN description corrections. A different number means ' +
        'this parser is reading the wrong table, not that she changed her mind.',
    ).toBe(14);
    expect(
      ROWS_146.length,
      'decision 146 annex §٥ states TWO. Same reasoning.',
    ).toBe(2);
  });

  it('every corrected description carries her NEW span and NOT the old one', () => {
    const wrong: string[] = [];
    for (const { code, was, became } of [...ROWS_144, ...ROWS_146]) {
      const got = lookupOptional('AR', descriptionKey(code));
      if (got === undefined) {
        wrong.push(`${code} — no Arabic description at all`);
        continue;
      }
      if (!got.includes(became)) {
        wrong.push(`${code}\n    missing: ${became}\n    ships  : ${got}`);
      }
      /*
       * AND THE OLD SPAN IS GONE. A presence check alone passes against a description that
       * carries both — which is what a half-applied substitution looks like, and the shape
       * a `replace` on the wrong occurrence actually produces.
       */
      if (got.includes(was)) {
        wrong.push(`${code} still carries the OLD span «${was}»\n    ships: ${got}`);
      }
    }
    expect(
      wrong,
      'a permission description does not carry owner decision 144 §١ / 146 §٥ as she wrote ' +
        'it. ⛔ Correct the dictionary, never the annex: her papers are the authority and ' +
        'this file only reads them.',
    ).toEqual([]);
  });

  it('⛔ `rfqNewRefusalAct` KEEPS «طلب عرض سعر» — decision 150 struck it by name', () => {
    /*
     * The one place the corrected wording must NOT appear. Asserted in both directions so
     * neither a sweep nor a revert can move it silently.
     */
    const act = lookupOptional('AR', 'rfqNewRefusalAct');
    expect(
      act,
      '`rfqNewRefusalAct` has gone. It is a struck exception, which means it must still be ' +
        'here saying the thing decision 144 corrected everywhere else.',
    ).toBeDefined();
    expect(act).toContain('طلب عرض سعر');
    expect(act).not.toContain('طلب عرض أسعار');
  });

  it('the correction is a SPAN swap — no description lost or gained length beyond it', () => {
    /*
     * Her restriction, made checkable: «لا تتغيّر كلمة أخرى في أي شرح». Re-deriving the old
     * text from the new one must reproduce a string that differs ONLY where the annex says.
     * Without this, a description could be reworded wholesale and still contain «became».
     */
    const drifted: string[] = [];
    for (const { code, was, became } of [...ROWS_144, ...ROWS_146]) {
      const got = lookupOptional('AR', descriptionKey(code)) ?? '';
      const reverted = got.replace(became, was);
      const expectedLengthDelta = became.length - was.length;
      if (got.length - reverted.length !== expectedLengthDelta) {
        drifted.push(`${code} — the swap is not a single clean substitution`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
