import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 152 — THE OPPORTUNITIES BUTTON, RE-SLICED FROM HER PAPER.
 *
 * ## Why this file exists
 *
 * The customer page's seventh control shipped as the bare «عرض», borrowed from `/employees`,
 * and that screen's own comment REPORTED «عرض الفرص» as an empty cell: joining two shipped
 * words into a third is what decision 125 forbids. She ratified the join in §١.
 *
 * ⛔ NOTHING HERE IS RETYPED. The expected string is read out of
 * `docs/decision-152-opportunities-button-english-prefix-nextjs.md` at test time, because a
 * test holding its own copy of her Arabic is a second home for it — free to agree with a
 * dictionary that drifted the same way.
 *
 * ## And §٢'s other half is asserted as an ABSENCE
 *
 * Ruling §٢ deletes «Process N — » from the English descriptions, as ruling 3 of decision 150
 * deleted «العملية N —» from the Arabic. The gate `check:process-prefix` is what holds that at
 * budget zero in both languages; what is asserted here is the one thing a gate cannot say —
 * that the twenty-five values still carry the words that came AFTER the prefix.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const PAPER = join(
  REPO,
  'docs',
  'decision-152-opportunities-button-english-prefix-nextjs.md',
);

/** The one data row of §١'s two-column table — not the header, not the separator. */
function ratifiedLabel(): string {
  const body = readFileSync(PAPER, 'utf8');
  const rows = [...body.matchAll(/^\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*$/gm)]
    .filter((m) => !m[1].includes('---') && m[1].trim() !== 'الموضع')
    .map((m) => m[2].trim());
  expect(
    rows,
    'decision 152 §١ must carry exactly one ratified string — if it does not, the comparison ' +
      'below is reading the wrong table and would pass against anything',
  ).toHaveLength(1);
  return rows[0];
}

describe('owner decision 152', () => {
  it('the opportunities button carries her word, byte for byte', () => {
    expect(lookupOptional('AR', 'oppListOpenButton')).toBe(ratifiedLabel());
  });

  it('it is no longer the bare «عرض» borrowed from /employees', () => {
    const label = lookupOptional('AR', 'oppListOpenButton');
    const borrowed = lookupOptional('AR', 'empViewButton');
    expect(borrowed).toBeTruthy();
    expect(label).not.toBe(borrowed);
    // NON-VACUOUS: the ratified label CONTAINS the borrowed word, so an assertion that only
    // checked for «عرض» would pass against the old state. This pins the difference.
    expect(label).toContain(borrowed as string);
  });

  it('and `/employees` keeps the bare word — only this control moved', () => {
    expect(lookupOptional('AR', 'empViewButton')).toBe('عرض');
    expect(lookupOptional('EN', 'empViewButton')).toBe('View');
  });

  it('the English half is a control label, not the refusal fragment', () => {
    // `oppListRefusalAct` happens to carry the same Arabic span — it is the ACT phrase inside a
    // refusal sentence. Its English is mid-sentence and lower-case; a button's is not.
    expect(lookupOptional('EN', 'oppListOpenButton')).toBe('View opportunities');
    expect(lookupOptional('EN', 'oppListRefusalAct')).toBe('view opportunities');
  });

  /**
   * §٢ — the prefix goes and NOTHING AFTER IT DOES. Spot-checked on the two ends of the range:
   * the lowest process number and the plural one, which is the shape a singular-only matcher
   * misses (the Arabic gate records that blindness for «العملية» vs «العمليات»; the English has
   * exactly the same two forms and `claimIntro` is the plural).
   */
  it('the English descriptions keep every word that followed the prefix', () => {
    expect(lookupOptional('EN', 'leadsProcessIntro')).toContain(
      'Capture a lead from any acquisition source',
    );
    expect(lookupOptional('EN', 'claimIntro')).toContain(
      'Notify claim → register → document',
    );
    for (const key of ['leadsProcessIntro', 'claimIntro', 'oppListIntro'] as const) {
      expect(lookupOptional('EN', key)).not.toMatch(/^Process(es)?\s+\d/);
    }
  });
});
