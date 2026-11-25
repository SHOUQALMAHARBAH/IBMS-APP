import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lookupOptional } from './translations';

/**
 * 🔴 OWNER DECISION 164 RULING 1 — THE ROLE-CREATED SENTENCE, RE-SLICED FROM HER PAPER.
 *
 * ## Why this file exists
 *
 * Decision 163 ruling 5 asked the engineer to find a shipped success sentence for «إنشاء الدور»
 * and to build nothing if there was none. There was none — measured, and reported with the three
 * nearest keys named. Decision 164 is her answer: «تم إنشاء الدور بنجاح».
 *
 * ⛔ NOTHING HERE IS RETYPED. The expected string is read out of
 * `docs/decision-164-role-created-toast.md` at test time, because a test holding its own copy of
 * her Arabic is a second home for it — free to agree with a dictionary that drifted the same way.
 *
 * ## ⚠️ AND THE ABSENT FULL STOP IS THE POINT OF THE SECOND TEST
 *
 * `roleDeleted` on the same screen is «تم حذف الدور.» WITH a stop. Hers has none. Appending one
 * «for consistency» is editing ratified text — the mistake decision 145 forbade by name when
 * «تعذّر إرفاق المراسلة.» was given a «— حاول مرة أخرى.» tail its siblings carried and hers did
 * not. So the absence is asserted, not left to a reader's eye.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const PAPER = join(REPO, 'docs', 'decision-164-role-created-toast.md');

/**
 * Her sentence, sliced from RULING TABLE ROW ١ of her own paper.
 *
 * 🔴 AND THE FIRST VERSION OF THIS SLICER WAS AMBIGUOUS, WHICH ITS OWN GUARD CAUGHT.
 *
 * It searched every «...» span in the file for one containing «إنشاء الدور بنجاح» and found
 * **two**: the ratified sentence, and her verbatim message in «كلام الإدارة بحرفه», which
 * EMBEDS it inside a longer utterance («1- تم إنشاء الدور بنجاح و بتطلع زي بوب أب صغيرة …»).
 * Picking either would have been a coin toss, and picking the longer one would have pinned the
 * dictionary to a sentence describing the toast rather than the toast's text.
 *
 * ⟶ So the slice is SCOPED TO THE SECTION that carries the ratified text, which is decision
 *   157's own rule: that paper has a row ٧ in table أ and a row ٧ in table ج, both four cells
 *   wide, so a cell-count filter would have pinned both keys to whichever table came first.
 *
 * ⚠️ AND THE ANCHOR CARRIES HER OWN `**`. The ratified span is the bolded one — the row's other
 * span, «إنشاء الدور», names the BUTTON rather than the message. Message 46 §4 is the precedent
 * for reading her bold rather than stripping it: a declaration with the bold removed is a span
 * the paper does not contain.
 *
 * ⚠️ Keyed on the row's CONTENT marker (`| ١ |`) and never on a line number: she appended a
 * second addendum to decision 151 mid-batch and every line below it moved (message 46 §7).
 */
function ratifiedSentence(): string {
  const body = readFileSync(PAPER, 'utf8');
  const rows = body
    .split(/\r?\n/)
    .filter((line) => /^\|\s*١\s*\|/.test(line));
  expect(
    rows,
    'decision 164 must carry exactly one ruling-table row ١ — if it carries none, this slicer ' +
      'is reading the wrong structure and would throw rather than pass silently',
  ).toHaveLength(1);

  const bolded = [...rows[0].matchAll(/\*\*«([^»]+)»\*\*/g)].map((m) => m[1]);
  expect(
    bolded,
    'ruling ١ must carry exactly one BOLDED «...» span — that is her ratified text, as against ' +
      'the unbolded «إنشاء الدور» in the same row, which names the button',
  ).toHaveLength(1);
  return bolded[0];
}

describe('owner decision 164 ruling 1 — the role-created confirmation', () => {
  it('ships her sentence byte-for-byte, in the Arabic half', () => {
    const expected = ratifiedSentence();
    // Non-vacuity: a slicer that returned '' would make every comparison below trivially true.
    expect(expected.length).toBeGreaterThan(10);
    expect(lookupOptional('AR', 'roleCreatedToast')).toBe(expected);
  });

  /**
   * ⛔ NO FULL STOP IS APPENDED, AND NO WORD IS ADDED EITHER. Pinned in BOTH directions: the key
   * equals her span exactly, and it is NOT her span plus a stop.
   */
  it('carries no full stop, where `roleDeleted` beside it does', () => {
    const shipped = lookupOptional('AR', 'roleCreatedToast');
    const expected = ratifiedSentence();
    expect(shipped).not.toBe(`${expected}.`);
    expect(shipped?.endsWith('.')).toBe(false);
    // Non-vacuous: the sibling really does end in one, so this is a difference and not a habit.
    expect(lookupOptional('AR', 'roleDeleted')?.endsWith('.')).toBe(true);
  });

  /**
   * ⛔ AND IT IS ITS OWN KEY, NOT A SECOND RENDER OF `roleDeleted` OR `roleMatrixSaved`.
   *
   * Decision 157 ruling 2's rule: a shipping word in a new site gets its own key with the same
   * text, never a second render of an existing one. Here the text is different too, so the
   * stronger claim holds — the three sentences on this screen name three different acts.
   */
  it('is distinct from the other two confirmations on the same screen', () => {
    const created = lookupOptional('AR', 'roleCreatedToast');
    expect(created).not.toBe(lookupOptional('AR', 'roleDeleted'));
    expect(created).not.toBe(lookupOptional('AR', 'roleMatrixSaved'));
  });

  /**
   * ⚠️ THE ENGLISH HALF IS THE PAPER'S ENGINEER SECTION, NOT «كلام الإدارة بحرفه» — asserted so
   * the weaker provenance is on the record rather than only in a comment. Every other ratified
   * name in this repository is Arabic with the English an EMPTY CELL (message 50 §13); this one
   * her paper supplies, and it is hers to correct in one line.
   */
  it('ships the English the paper itself gives', () => {
    const body = readFileSync(PAPER, 'utf8');
    const english = 'Role created successfully.';
    expect(
      body.includes(english),
      'the English half must come from her paper — if this fails, it was invented here',
    ).toBe(true);
    expect(lookupOptional('EN', 'roleCreatedToast')).toBe(english);
  });
});
