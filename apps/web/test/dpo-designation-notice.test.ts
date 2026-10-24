import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COMMON } from '../lib/i18n/translations/common';

/**
 * THE OWNER'S OWN TEXT, PINNED AT BYTE LEVEL.
 *
 * ## Why a hash and not a string comparison
 *
 * The recorded hazard, found the hard way on the `sanctions-pep.screen` line: my first transcription
 * of her Arabic differed at THREE positions where a shadda and a vowel sit in the OPPOSITE ORDER
 * (U+0651 before U+064F/U+064E instead of after). Canonically equivalent, rendered identically, and
 * nothing would ever have failed — while a non-NFC string compares UNEQUAL to the same text typed
 * into a search box or stored in a column.
 *
 * A second retyping of the text inside this file would be a second chance at the same error, and the
 * two copies could drift without either looking wrong. So the pin is the SHA-256 of the NFC form,
 * computed once from the file she supplied, and this test re-computes it from the dictionary.
 *
 * ## What is hashed
 *
 * Her text is four paragraphs. The dictionary holds the first three as `dpoAssignNotice` and the
 * fourth — her closing instruction to acknowledge — as `dpoAssignAcknowledge`, so the screen can use
 * the last line as the checkbox's own label without it appearing twice. The CONCATENATION is what
 * must equal her text, and it is also exactly what the screen sends as `noticeShown`, which is what
 * the record ends up carrying.
 *
 * If this fails: do NOT edit the hash. Her text is the authority; a changed hash means somebody
 * reworded a legal notice she wrote.
 */
const OWNER_TEXT_SHA256 =
  'eecf5f3bdb189c049b7f4cb570f043860ba5bf26cac7101fda1645fcd8e04755';

/**
 * Read from the DICTIONARY FILE rather than through `translate`, because `translate` interpolates
 * and would hide a stray placeholder in a legal notice: a `{min}` left in her text would render
 * literally on screen and still satisfy a `toContain` here.
 */
function assembled(language: 'AR' | 'EN'): string {
  const dict = COMMON[language];
  return `${dict.dpoAssignNotice}\n\n${dict.dpoAssignAcknowledge}`;
}

describe('the combined-assignment notice is the owner’s own text', () => {
  it('reproduces her four paragraphs exactly, by hash', () => {
    const text = assembled('AR');
    expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(
      OWNER_TEXT_SHA256,
    );
  });

  /**
   * NFC, asserted separately from the hash. The hash alone would catch a non-NFC form — it would
   * simply differ — but it could not SAY what was wrong, and "the hash moved" sends a reader hunting
   * a reworded sentence rather than a normalisation. This names the real cause.
   */
  it('is NFC, so it compares equal to the same text typed or stored anywhere else', () => {
    const text = assembled('AR');
    expect(text.normalize('NFC')).toBe(text);
  });

  /**
   * THE THREE CLAUSES THAT CARRY THE DECISION, asserted one at a time rather than as one
   * `toContain` of the whole sentence — the no-floor notice's own rule, because a reword that drops
   * any one of them would still satisfy a single whole-text check, and each of these is the clause a
   * well-meaning edit deletes as hedging.
   */
  it('names the article, the exposure, and that the arrangement is the office’s to make', () => {
    const ar = assembled('AR');
    // The article. A notice that states an exposure without naming the provision it comes from is
    // this product making a legal claim with no source.
    expect(ar).toContain('١١/أ');
    // The exposure, by article. Both are named in her text and both matter: 21 and 22.
    expect(ar).toContain('٢١');
    expect(ar).toContain('٢٢');
    // AND THAT IT IS PERMITTED. This is the half the struck hard block would have contradicted, and
    // the half an office of one person needs: the system records it and does not prevent it.
    expect(ar).toContain('يسجّله ولا يمنعه');
  });

  /**
   * THE ENGLISH IS THE DICTIONARY'S FALLBACK AND CARRIES THE SAME CLAUSES. It is NOT pinned by hash:
   * it is not hers, so pinning it would assert an authorship it does not have. What it must do is
   * make the same statements, because an English reader must not be shown a weaker notice.
   */
  it('has an English fallback making the same three statements', () => {
    const en = assembled('EN');
    expect(en).toContain('article 11/a');
    expect(en).toContain('articles 21 and 22');
    expect(en).toMatch(/records it and does not prevent it/i);
    // AND IT MUST NOT READ AS A PROHIBITION. The adviser's own answer says the combination is
    // impermissible; the owner decided otherwise, and the notice is where that decision is stated.
    expect(en).not.toMatch(/must not|not permitted|prohibited|may not assign/i);
  });

  /**
   * NO REASON IS ASKED FOR — deliberately lighter than decision 28, whose notice ends by asking for
   * a written reason. Here the reason is the same every time, so a reason box would be answered
   * identically and become wallpaper. An absence is the only form of that which can fail.
   */
  it('asks for an acknowledgement and not for a written reason', () => {
    expect(assembled('AR')).toContain('أقِرَّ');
    expect(assembled('AR')).not.toContain('السبب');
    expect(assembled('EN')).toMatch(/acknowledge/i);
    expect(assembled('EN')).not.toMatch(/\breason\b/i);
  });
});
