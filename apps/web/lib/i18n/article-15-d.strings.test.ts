import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from './translations/permissions';
import { lookupOptional } from './translations';

/**
 * ART. 15/d's FIVE EXEMPTION LABELS, RE-SLICED FROM OWNER DECISION 133 AND COMPARED BYTE FOR BYTE.
 *
 * ## 🔴 WHY THIS FILE EXISTS, AND IT IS NOT A PRECAUTION
 *
 * The labels went to the owner once already and TWO of the five were wrong, in the same way:
 * exemption 5 carried a NOTE from our own reference paper instead of the clause, and exemption 2
 * carried markdown bold the instrument does not have. Both were sliced from
 * `docs/legal/cbj-instructions-9-2026-source-text.md` — **our transcription** — which carries our
 * commentary and our formatting.
 *
 * ⟶ So the source is decision 133's own table from here on, whose text she read off the page
 *   image and cited to printed page 17, and this spec re-slices from there. A hand-edit to the
 *   dictionary fails with the source named.
 *
 * ## AND EXEMPTION 4 IS A TEMPLATE, WHICH IS THE SHARPER HALF
 *
 * Her ratified sentence carries the ceiling «٢٠٠٠». The figure is NEVER typed into the string:
 * the label is split either side of it and `{ceiling}` renders from
 * `SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD`, read at the request's own date.
 *
 * So the assertion is a RENDER rather than a comparison: filling the template with the seeded
 * row's figure must reproduce her sentence exactly. **If the row moves and the label does not,
 * this fails** — which is what message 38 §1 asked for.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const D133 = join(REPO, 'docs', 'decision-133-strings-ratified.md');
const LEGAL_VALUES = join(
  REPO,
  'packages',
  'db',
  'prisma',
  'seed-data',
  'legal-values.ts',
);
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Decision 133's exemption table: Arabic-ordinal row -> the quoted clause. */
function ratifiedExemptions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(D133, 'utf8').split('\n')) {
    const m = new RegExp(
      `^\\|\\s*([${AR_DIGITS}]+)\\s*\\|\\s*«(.+?)»`,
    ).exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The first «…» span of the decision-133 row whose site cell is `site`. */
function ratifiedRow(site: string): string {
  const row = readFileSync(D133, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .find((cells) => cells.length >= 2 && cells[0] === site);
  expect(row, `decision 133 has no row for «${site}»`).toBeDefined();
  const m = /«(.+?)»/.exec(row![1]);
  expect(m, `decision 133's row for «${site}» carries no quoted sentence`).not.toBeNull();
  return m![1];
}

/** The seeded ceiling, read out of the catalogue source — the figure's one home. */
function seededCeiling(): string {
  const src = readFileSync(LEGAL_VALUES, 'utf8');
  const i = src.indexOf('SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD');
  expect(i, 'the ceiling code is not in the legal-values catalogue').toBeGreaterThan(-1);
  const m = /value:\s*"([^"]+)"/.exec(src.slice(i));
  expect(m, 'the ceiling row carries no value').not.toBeNull();
  return m![1];
}

/** Western digits to Arabic-Indic, which is the form the instrument writes. */
function toArabicIndic(n: string): string {
  return n.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

/**
 * The Arabic value for a key.
 *
 * `lookupOptional` rather than the raw map: `translations.ts` exports the lookup and not the
 * object, deliberately — `translate()` takes a `TranslationKey` so a typo cannot reach it, and
 * the optional form is what a test holding key NAMES needs.
 */
function ar(key: string): string {
  const value = lookupOptional('AR', key as never);
  expect(value, `${key} has no Arabic value at all`).toBeTruthy();
  return value as string;
}

describe('OWNER DECISION 133 — the five exemption labels are hers, byte for byte', () => {
  const ratified = ratifiedExemptions();

  it('slices exactly five from her table', () => {
    // Non-vacuity: a drifted matcher would make every comparison below compare undefined to
    // undefined, which is the shape `screen-route-permission-fit.py` asserts against.
    expect(Object.keys(ratified).sort()).toEqual(
      ['١', '٢', '٣', '٤', '٥'].sort(),
    );
  });

  it.each([
    ['a15dExemption1', '١'],
    ['a15dExemption2', '٢'],
    ['a15dExemption3', '٣'],
    ['a15dExemption5', '٥'],
  ])('%s is exactly her clause', (key, ordinal) => {
    expect(
      ar(key),
      `${key} is not byte-identical to OWNER DECISION 133's own table. Re-slice it from ` +
        'docs/decision-133-strings-ratified.md rather than editing it here. ⛔ And do NOT take ' +
        'it from docs/legal/cbj-instructions-9-2026-source-text.md: that file is our own ' +
        'transcription, and both of this table\'s two corrections came from doing exactly that.',
    ).toBe(ratified[ordinal]);
  });

  it('🔴 exemption 4 RENDERS to her clause with the seeded ceiling, and the figure is not in the string', () => {
    const template = ar('a15dExemption4');

    // The figure is NOT typed into the label. This is the half that makes the render meaningful:
    // a label with «٢٠٠٠» baked in would pass the comparison below and be wrong the day the row
    // moves, which is the whole reason the owner ruled the figure comes from the table.
    expect(
      template.includes(toArabicIndic('2000')),
      'the ceiling is written INTO the exemption-4 label. It must render from ' +
        'SINGLE_INSURER_EXEMPTION_PREMIUM_CEILING_JOD at the request\'s own date — OWNER ' +
        'DECISION 133 says so on the row itself.',
    ).toBe(false);
    expect(template).toContain('{ceiling}');

    // And rendering it with the SEEDED figure reproduces her sentence exactly.
    const ceiling = toArabicIndic(String(Number(seededCeiling())));
    expect(
      template.replace('{ceiling}', ceiling),
      "rendering exemption 4's label with the seeded ceiling does not reproduce OWNER DECISION " +
        '133\'s ratified sentence. Either the label drifted, or the legal-values row moved — and ' +
        'if the row moved, her sentence describes a ceiling the system no longer applies, which ' +
        'is hers to re-ratify.',
    ).toBe(ratified['٤']);
  });

  it('and the premium ALERT is the same shape — her sentence, the figure from the row', () => {
    const template = ar('a15dPremiumAlert');
    expect(template.includes(toArabicIndic('2000'))).toBe(false);
    expect(template).toContain('{ceiling}');
    const ceiling = toArabicIndic(String(Number(seededCeiling())));
    expect(template.replace('{ceiling}', ceiling)).toBe(
      ratifiedRow('التنبيه حين يرجع العرض أعلى من الحدّ'),
    );
  });

  it.each([
    ['a15dQuestion', 'السؤال حين يذهب الطلب لأقل من ثلاث'],
    ['a15dPremiumLabel', 'خانة القسط المتوقّع'],
    ['a15dEvidenceLabel', 'خانة دليل طلب العميل'],
    ['a15dTaggedBySystem', 'على السجل، حين يحدّده النظام (غير مستعمل اليوم)'],
  ])('%s is exactly what she wrote', (key, site) => {
    expect(ar(key)).toBe(ratifiedRow(site));
  });

  it('the «chosen by» label is hers, with the name appended rather than interpolated', () => {
    /*
     * Her cell reads «اختاره: » + the employee's name from the system — so the LABEL carries the
     * colon and the name follows it. Asserted as a prefix rather than a whole string, because
     * the name is appended by the record and is not part of what she ratified.
     */
    expect(ar('a15dChosenBy')).toBe(
      ratifiedRow('على السجل، حين يختار الموظف'),
    );
  });
});

describe('OWNER DECISION 133 — the two legal-value descriptions, in the permission dictionary', () => {
  /*
   * These live in `permissions.ts` rather than `rfq.ts` and are asserted in
   * `lib/admin/permission-descriptions.test.ts` too. Repeated HERE only as a pointer, so that a
   * reader looking for "which decision-133 strings are pinned and where" finds one answer.
   */
  it('are pinned by permission-descriptions.test.ts, and the keys still exist', () => {
    expect(PERMISSIONS.AR['perm:legal-value.read']).toBeTruthy();
    expect(PERMISSIONS.AR['perm:legal-value.declare']).toBeTruthy();
  });
});
