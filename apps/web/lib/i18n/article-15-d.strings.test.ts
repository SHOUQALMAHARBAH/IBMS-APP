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

/**
 * 🔴 OWNER DECISION 139 ruling 6 — THE EMPTY LIST'S SENTENCE, RE-SLICED AND COMPARED.
 *
 * `Article15DWindow.tsx` mapped `options.evidence` with no empty branch, so the one employee the
 * decision is about — whose customer asked by telephone — met a label with blank space under it.
 *
 * The sentence is hers and its ORDER is the decision: there is none yet · YOU MAY CARRY ON · log
 * the request. The middle clause is why it had to be ratified rather than composed — the server
 * stopped refusing this, so a sentence that read as a dead end would contradict the ruling it is
 * there to express. It replaces a draft opening «أولاً», which read as «do this FIRST».
 */
describe('OWNER DECISION 139 — the empty evidence list says what she wrote', () => {
  const D139 = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'decision-139-exemption-5-proceed-then-evidence.md',
  );

  /** The ratified sentence, re-sliced from the decision's own ruling table. */
  function ratified(): string {
    const line = readFileSync(D139, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.includes('لا توجد مراسلة واردة'));
    expect(
      line,
      'decision 139 no longer contains the empty-list sentence — the slice source moved',
    ).toBeDefined();
    const match = /«(.+?)»/.exec(line!.slice(line!.indexOf('**«')));
    expect(match).not.toBeNull();
    return match![1];
  }

  it('says exactly what she ratified, byte for byte', () => {
    expect(
      lookupOptional('AR', 'a15dEvidenceNoneYet'),
      'the empty-evidence sentence is not byte-identical to OWNER DECISION 139 ruling 6. It is ' +
        'HER sentence: re-slice it from docs/decision-139-...md rather than editing it here.',
    ).toBe(ratified());
  });

  it('and it does NOT open with «أولاً» — the draft she replaced', () => {
    /*
     * Not decoration. The rejected draft began «أولاً», which reads as an instruction to log the
     * message BEFORE proceeding — the exact opposite of the ruling, on the one screen where the
     * employee is deciding whether they may proceed at all. A later edit reaching for that word
     * would undo the decision while leaving the sentence looking right.
     */
    const ar = lookupOptional('AR', 'a15dEvidenceNoneYet') ?? '';
    expect(ar.startsWith('أولاً')).toBe(false);
    expect(ar).toContain('يمكنك المتابعة');
  });
});

/**
 * 🔴 OWNER DECISION 143 — «إرفاق المراسلة», RE-SLICED FROM HER PAPER AND COMPARED.
 *
 * ## WHY THIS WORD NEEDED A DECISION AT ALL
 *
 * `POST /rfqs/:id/article-15-d/evidence` shipped on 2026-11-15 built, enforced and e2e-tested in
 * three directions — and with no control on any screen, because the label did not exist.
 * Measured that day: «إرفاق» ships only on the DOCUMENTS screens and «المراسلة» only in the
 * plural on the request screen, and OWNER DECISION 125 forbids joining two shipped words into a
 * third. So the route was declared unreached with the creditor named — one ratified word — and
 * the mark «بلا إثبات» could be cleared by API and by nobody using the product.
 *
 * ⟶ She ratified the proposal whole («موافقة عليها»), so it is HERS and is sliced from her own
 *   one-sentence section rather than retyped here or in the dictionary.
 */
describe('OWNER DECISION 143 — the attach button says exactly what she ratified', () => {
  const D143 = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'decision-143-attach-communication-button-label.md',
  );

  /**
   * The ratified label, re-sliced from decision 143's own `## ١ — القرار بجملة واحدة`.
   *
   * ⚠️ THE SENTENCE CARRIES TWO «…» SPANS AND THE LABEL IS THE SECOND. The first is the MARK —
   * «بلا إثبات» — which the button is shown beside and must never be confused with: a slice
   * taking the first span would put the mark's own name on the control that clears it, and the
   * test would still pass against a dictionary that had made the same mistake.
   */
  function ratifiedLabel(): string {
    const body = readFileSync(D143, 'utf8');
    /*
     * ⚠️ SLICED BY INDEX RATHER THAN BY ONE REGEX, and the reason is a defect this very test hit
     * on its first run. The body was closed by a lookahead ending `|$` under the `m` flag — where
     * `$` is END OF LINE, not end of string — so the section ended at the first line break, came
     * back empty, and the test reported that her sentence carried no quoted spans. A false
     * accusation against the decision file, raised by the instrument reading it.
     */
    const lines = body.split('\n');
    const headings = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.startsWith('## '));
    const start = headings.find(
      ({ line }) => line.includes('القرار') && line.includes('بجملة'),
    );
    expect(
      start,
      'decision 143 has no one-sentence section — the slice source moved',
    ).toBeDefined();
    const next = headings.find(({ i }) => i > start!.i);
    const section = lines
      .slice(start!.i + 1, next ? next.i : undefined)
      .join('\n');
    const spans = [...section.matchAll(/«(.+?)»/g)].map((m) => m[1]);
    expect(
      spans,
      'decision 143’s sentence no longer carries the mark and the label, in that order',
    ).toHaveLength(2);
    expect(spans[0], 'the first span is the MARK, not the label').toBe(
      'بلا إثبات',
    );
    return spans[1];
  }

  it('is byte-identical to the label in OWNER DECISION 143', () => {
    expect(
      lookupOptional('AR', 'a15dAttachEvidenceButton'),
      'the attach button label is not byte-identical to OWNER DECISION 143. It is HER word: ' +
        're-slice it from docs/decision-143-...md rather than editing it here.',
    ).toBe(ratifiedLabel());
  });

  it('and it is NOT the mark it clears', () => {
    /*
     * Not decoration. The mark and the button sit one line apart on the same screen, and a
     * dictionary edit that put «بلا إثبات» on the control would read as plausible in review
     * while telling the employee the button applies the mark rather than removes it.
     */
    expect(lookupOptional('AR', 'a15dAttachEvidenceButton')).not.toBe(
      lookupOptional('AR', 'a15dExemptionLacksEvidence'),
    );
  });

  it('and the English side exists, because the screen is bilingual', () => {
    expect(lookupOptional('EN', 'a15dAttachEvidenceButton')).toBeTruthy();
  });
});
