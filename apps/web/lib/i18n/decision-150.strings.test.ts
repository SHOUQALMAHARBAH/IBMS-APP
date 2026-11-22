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

/** Heading prefixes, built rather than written inline: a `\n###` literal has been mangled by a
 *  heredoc on this host often enough that it is worth not writing one at all. */
const NEXT_H3 = '\n### ';
const NEXT_H2 = '\n## ';

/**
 * 🔴 COMPOSED WITH OWNER DECISION 146 RULING 1-أ, ADDED 2026-11-19.
 *
 * Decision 150's annex §٥ was generated before decision 146's digit sweep was applied, so its
 * cells still carry Eastern Arabic-Indic numerals where a string contains a number. Decision
 * 151's own annex states how the two meet: *«ما يغيّره القراران ١٤٦ و١٥٠ في النصوص نفسها
 * يُطبَّق بمقاطعه هو»* — each decision is applied by its OWN spans. 150 settles the WORDS; 146
 * settles the DIGITS, and its annex §٣ is explicit that nothing else moves: *«الرقم وحده
 * يتبدّل، حرفاً بحرف. لا تتغيّر كلمة.»*
 *
 * ⟶ So the annex's text is read unchanged and the DIGIT RULE is applied to it here, rather
 *   than editing her paper to match the code — which is the one thing this repository never
 *   does. Measured: exactly ONE of the forty-four carries a digit at all,
 *   `renARenewalCaseOpensAutomatically`'s «٩٠ يوماً».
 *
 * ⛔ This is a character mapping and NOT a normaliser. It cannot hide a changed word, so a
 *   string that drifted in any other way still fails this comparison by name.
 */
function composeWithDecision146(text: string): string {
  return text.replace(/[٠-٩]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30),
  );
}

/**
 * 🔴 COMPOSED WITH OWNER DECISION 153 §٢ ROW ١٨ TOO, ADDED 2026-11-22 (message 51 §1).
 *
 * `customerCrmIntro` is in decision 150's annex §٥, and decision 153 §٢ row ١٨ later changed it:
 * the trailing parenthetical listing which modules the 360° timeline can reach yet is removed.
 * Decision 150's annex cannot know that — it predates the ruling.
 *
 * ⟶ So 153's span is applied TO HER 150 TEXT at comparison time, exactly as decision 146's digit
 *   rule already is above, and for the reason decision 151's annex states: «ما يغيّره القراران
 *   ١٤٦ و١٥٠ في النصوص نفسها يُطبَّق بمقاطعه هو» — each decision applies by its own spans.
 *   ⛔ Her paper is never edited.
 *
 * ⚠️ AND THE REPLACEMENT IS SLICED FROM DECISION 153, never written here — a test holding its own
 *   copy of her Arabic is a second home for it, free to agree with a dictionary that drifted the
 *   same way. The non-vacuity floor below is what stops this composition quietly becoming the
 *   identity function and going back to asserting the pre-153 text.
 */
const SUPERSEDED_BY_153: Readonly<Record<string, string>> = {
  customerCrmIntro: '١٨',
};

function decision153Row(id: string): { was: string; now: string } {
  const body = readFileSync(
    join(REPO, 'docs', 'decision-153-answer-sheet-3.md'),
    'utf8',
  );
  const at = body.indexOf('## ٢');
  expect(at, 'decision 153 §٢ not found').toBeGreaterThan(-1);
  const ends = [body.indexOf(NEXT_H3, at + 1), body.indexOf(NEXT_H2, at + 1)]
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const section = ends.length > 0 ? body.slice(at, ends[0]) : body.slice(at);
  const rows = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) => line.slice(1, -1).split('|').map((c) => c.trim()))
    .filter((c) => c.length === 4 && c[0] === id);
  expect(rows, `decision 153 §٢ must carry exactly one row ${id}`).toHaveLength(1);
  return { was: rows[0][2], now: rows[0][3] };
}

function composeWithDecision153(key: string, text: string): string {
  const id = SUPERSEDED_BY_153[key];
  return id ? decision153Row(id).now : text;
}

describe('OWNER DECISION 150 — the ratified strings, re-sliced from the annex', () => {
  it('the annex still carries all forty-four keys', () => {
    // Non-vacuity. Every assertion below iterates this map, so an annex that stopped parsing
    // would make the whole file pass while checking nothing.
    expect(ratifiedStrings().size).toBe(44);
  });

  it('every ratified string ships byte-for-byte as she wrote it', () => {
    const want = ratifiedStrings();
    const mismatched: string[] = [];

    let composed = 0;
    let composed153 = 0;
    for (const [key, text] of want) {
      if (key === DELETED_BY_SECTION_3) continue;
      // Counted SEPARATELY, so each composition carries its own non-vacuity floor. A single
      // counter would let one of the two silently become the identity function while the
      // other kept the total above zero.
      const after153 = composeWithDecision153(key, text);
      if (after153 !== text) composed153 += 1;
      const expected = composeWithDecision146(after153);
      if (expected !== after153) composed += 1;
      // `lookupOptional` rather than the raw map: `translations.ts` exports the lookup and not
      // the object, which is the same reason `article-15-d.strings.test.ts` uses it.
      const got = lookupOptional('AR', key);
      if (got !== expected) {
        mismatched.push(`${key}\n    want: ${expected}\n    got : ${String(got)}`);
      }
    }

    expect(
      mismatched,
      'a ratified string does not ship as decision 150 §٥ has it, with decision 146 ruling ' +
        '1-أ’s digits applied. ⛔ Correct the dictionary, never the annex: her papers are the ' +
        'authority and this file only reads them.',
    ).toEqual([]);

    /*
     * The non-vacuity floor for the composition itself. If `composeWithDecision146` ever
     * stopped matching — a changed code range, a regex typo — it would become the identity
     * function and this whole comparison would silently go back to asserting the PRE-146 text,
     * which is the direction that passes while being wrong.
     */
    expect(
      composed,
      'no ratified string needed decision 146’s digit rule applied, so the composition above ' +
        'proved nothing. Exactly one of the forty-four carries a digit — ' +
        '`renARenewalCaseOpensAutomatically`’s «٩٠ يوماً».',
    ).toBe(1);

    /*
     * The same floor for decision 153’s span. If `SUPERSEDED_BY_153` were emptied, or its
     * row id drifted, this comparison would go back to asserting the PRE-153 text for
     * `customerCrmIntro` — and pass, because the annex and the dictionary would then agree
     * about a sentence her later ruling shortened.
     */
    expect(
      composed153,
      'no ratified string needed decision 153 §٢ applied, so that composition proved ' +
        'nothing. Exactly one of the forty-four was superseded — `customerCrmIntro`, row ١٨.',
    ).toBe(1);
  });

  it('⚠️ and decision 153 row ١٨ really did shorten what decision 150 ratified', () => {
    /*
     * NON-VACUITY FOR THE SUPERSESSION ITSELF, in the other direction: 150’s annex text must
     * still CONTAIN what 153 removes. Without this, a future edit that made the two papers agree
     * would leave `composeWithDecision153` replacing a string with itself — counted, floor
     * satisfied, and proving nothing.
     */
    const annex = ratifiedStrings().get('customerCrmIntro');
    const { now } = decision153Row(SUPERSEDED_BY_153.customerCrmIntro);
    expect(annex, 'customerCrmIntro left decision 150’s annex').toBeTruthy();
    expect(annex).not.toBe(now);
    expect(annex!.length).toBeGreaterThan(now.length);
    expect(annex).toContain('(');
    expect(now).not.toContain('(');
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
