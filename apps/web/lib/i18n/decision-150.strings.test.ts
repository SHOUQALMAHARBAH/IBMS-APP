import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 150's FORTY-FOUR STRINGS, RE-SLICED FROM HER ANNEX AND COMPARED BYTE FOR BYTE.
 *
 * ## Why this file exists
 *
 * Four rulings move spans inside shipping Arabic: «الإحلال» ⟶ «التنسيب» (5 strings), the
 * «العملية N —» prefix deleted (25), «مهمة ليلية»/«كنس» reworded (8 spans in 5), and «الخط» ⟶
 * «فرع التأمين» (23 spans in 19). A span-by-span edit is exactly the kind of change that looks
 * done and is one character out, so the annex also carries **§٥ — the FULL text of every touched
 * key after the rulings**, and that is what this file re-slices and compares.
 *
 * ⛔ NOTHING HERE IS RETYPED. Every expected string is read out of
 * `docs/decision-150-ratified-strings.md` at test time. A test holding its own copy of her
 * Arabic would be a second home for it, free to drift from the paper — which is the thing the
 * whole slicing discipline exists to prevent.
 *
 * ## ⚠️ ONE OF THE FORTY-FOUR IS DELIBERATELY ABSENT
 *
 * `rfqNewLineHint` was DELETED by §3 of the same batch: the RFQ line field became a CHOICE, so a
 * hint telling the reader how to type into a box no longer describes anything. Its two «فرع
 * التأمين» spans fall away with it. That absence is ASSERTED below rather than skipped — if the
 * key ever comes back, it must come back saying what she ratified, and a silent `continue` would
 * let it return with the old wording.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ANNEX = join(REPO, 'docs', 'decision-150-ratified-strings.md');

/** `key -> the full text after decision 150`, sliced from annex §٥'s own table. */
function ratifiedStrings(): Map<string, string> {
  const body = readFileSync(ANNEX, 'utf8');
  const marker = '## ٥ —';
  const at = body.indexOf(marker);
  expect(
    at,
    'annex §٥ (the full-text table) is not in docs/decision-150-ratified-strings.md',
  ).toBeGreaterThan(-1);

  const out = new Map<string, string>();
  for (const line of body.slice(at).split('\n')) {
    const m = /^\|\s*`([A-Za-z0-9_]+)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/** The key that §3 removed, and the reason it is named here rather than filtered out. */
const DELETED_BY_SECTION_3 = 'rfqNewLineHint';

describe('OWNER DECISION 150 — the ratified strings, re-sliced from the annex', () => {
  it('the annex still carries all forty-four keys', () => {
    // Non-vacuity. Every assertion below iterates this map, so an annex that stopped parsing
    // would make the whole file pass while checking nothing.
    expect(ratifiedStrings().size).toBe(44);
  });

  it('every ratified string ships byte-for-byte as she wrote it', () => {
    const want = ratifiedStrings();
    const mismatched: string[] = [];

    for (const [key, text] of want) {
      if (key === DELETED_BY_SECTION_3) continue;
      // `lookupOptional` rather than the raw map: `translations.ts` exports the lookup and not
      // the object, which is the same reason `article-15-d.strings.test.ts` uses it.
      const got = lookupOptional('AR', key);
      if (got !== text) {
        mismatched.push(`${key}\n    want: ${text}\n    got : ${String(got)}`);
      }
    }

    expect(
      mismatched,
      'a ratified string does not ship as decision 150 §٥ has it. ⛔ Correct the dictionary, ' +
        'never the annex: her paper is the authority and this file only reads it.',
    ).toEqual([]);
  });

  it(`⚠️ ${DELETED_BY_SECTION_3} is GONE, because the line field became a choice`, () => {
    expect(
      lookupOptional('AR', DELETED_BY_SECTION_3),
      'the hint came back. It told the reader how to type a value into a box that no longer ' +
        'exists, and its two examples were Arabic the server refuses. If a chooser needs a ' +
        'sentence, that sentence is the owner’s to write — ⛔ it is not composed from the old one.',
    ).toBeUndefined();
    expect(lookupOptional('EN', DELETED_BY_SECTION_3)).toBeUndefined();
  });

  it('⛔ and rfqNewRefusalAct still says «سعر» — a struck exception, not an oversight', () => {
    /*
     * Decision 144 ruling 8-أ settles «طلب عرض أسعار» everywhere else, and the heading on the
     * very same screen says «طلب عرض أسعار جديد». The owner was shown that contradiction, in
     * those words, and ruled: «بتضل «سعر» كاستثناء لهالجملة لحالها».
     *
     * ⟶ So this is pinned the other way round from everything above: the test exists to stop a
     *   later tidy-up ALIGNING it. Changing it would overrule a decision taken with the
     *   contradiction on the table.
     */
    expect(lookupOptional('AR', 'rfqNewRefusalAct')).toBe('إنشاء طلب عرض سعر');
  });
});
