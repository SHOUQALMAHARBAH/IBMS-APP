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
 *
 * ## 🔴 THE HASH MOVED ONCE, 2026-11-19, AND SHE IS WHY — OWNER DECISION 146 RULING 1-أ
 *
 * «كل رقم مكتوب في نصوص النظام غربي», and annex §٣ names `dpoAssignNotice` as ROW 3 of the
 * fifty-three, listing the figures it changes: «٢٤ · ٢٠٢٣ · ١١ · ٢١ · ٢٢ ⟶ 24 · 2023 · 11 · 21
 * · 22». So the notice now writes its article numbers in Western digits.
 *
 * ⟶ AND THE PIN GOT STRONGER RATHER THAN WEAKER, because swapping one hash for another proves
 *   only that somebody computed a hash. `PRE_146_SHA256` is the ORIGINAL, kept, and the second
 *   assertion below maps the shipping text's Western digits BACK to Eastern ones and requires
 *   that it reproduces it. That is the ruling's own statement — *«الرقم وحده يتبدّل، حرفاً
 *   بحرف. لا تتغيّر كلمة»* — made checkable: if one word of her notice were reworded while the
 *   digits were changed, the inverse would NOT hash to the original and this file would say so.
 */
const OWNER_TEXT_SHA256 =
  'e26a57114f8322aac91105e8516ad4f7ece396fd4fe9370759a313b945cc9ad1';

/** Her text as supplied, before decision 146's digit rule. ⛔ Never delete this: it is what
 *  makes "only the digits moved" an assertion instead of a claim. */
const PRE_146_SHA256 =
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

  it('🔴 decision 146 changed the DIGITS and nothing else — proven by inverting them', () => {
    /*
     * Map every Western digit back to its Eastern counterpart and require her ORIGINAL hash.
     * A reword smuggled in alongside the digit change cannot survive this: the inverse would
     * hash to something else, and no amount of re-running would make it match.
     */
    const backToEastern = assembled('AR').replace(/[0-9]/g, (d) =>
      String.fromCharCode(d.charCodeAt(0) - 0x30 + 0x0660),
    );
    expect(
      createHash('sha256').update(backToEastern, 'utf8').digest('hex'),
      'The notice no longer differs from the owner’s supplied text by digits ALONE. Decision ' +
        '146 ruling 1-أ permits exactly one change to it — «الرقم وحده يتبدّل، حرفاً بحرف. لا ' +
        'تتغيّر كلمة» — so a failure here means a word of a legal notice she wrote was changed ' +
        'as well. ⛔ Do not update either hash: restore her wording.',
    ).toBe(PRE_146_SHA256);
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
    //
    // 🔴 WESTERN DIGITS SINCE 2026-11-19 — owner decision 146 ruling 1-أ, annex §٣ row 3. The
    // CLAUSE each of these names is unchanged; only how its number is written moved.
    expect(ar).toContain('11/أ');
    // The exposure, by article. Both are named in her text and both matter: 21 and 22.
    expect(ar).toContain('21');
    expect(ar).toContain('22');
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
