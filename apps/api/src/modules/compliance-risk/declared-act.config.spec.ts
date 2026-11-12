import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARTICLE_15_D,
  ARTICLE_15_D_LIMIT,
  ARTICLE_15_D_RELEASE_ANCHOR,
  DECLARED_ACT_REASON_MIN_LENGTH,
  DECLARED_ACT_SHOWN_TEXT_MIN_LENGTH,
} from './declared-act.config';

/**
 * EVERY ARABIC STRING IN `declared-act.config.ts` IS RE-SLICED FROM ITS SOURCE HERE AND COMPARED
 * BYTE FOR BYTE.
 *
 * This is the shape `screen-copy.test.ts` uses for decision 54 and `legal-values-parity.spec.ts`
 * uses for the instrument's figures: the config is not trusted to have been copied correctly, it is
 * proven against the file it was copied FROM. A hand-edit to either side fails and the message
 * names the source.
 *
 * It matters more here than usual. The adviser's text is what a person is shown before admitting a
 * regulatory breach, and the record testifies to what they saw — so a silent edit to the config
 * would make every row written afterwards testify to a sentence the adviser never wrote.
 */

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const SIX = join(REPO, 'docs/answers/legal-counsel-six-items-verbatim.md');
const FIVE = join(REPO, 'docs/answers/legal-counsel-five-items-verbatim.md');
const PAPER = join(
  REPO,
  'docs/modules/module-01-declared-action-and-legal-values.md',
);

function lines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n');
}

/**
 * The two answer files carry the SAME art. 15/d text at DIFFERENT line numbers — the six-item
 * file at 198/202, the five-item file at 210/214 (1-based). Measured, and the first version of
 * this spec read index 197 in both and failed: a shared offset was an assumption, not a fact.
 */
const AT = {
  six: { window: 197, ack: 201 },
  five: { window: 209, ack: 213 },
} as const;

/** The adviser's window text, as it sits in his own file. */
function adviserWindowText(src: string[], at: number): string {
  return src[at].trim().replace(/^"|"$/g, '');
}

/** The adviser's acknowledgement, with the markdown bullet removed and nothing else. */
function adviserAcknowledgement(src: string[], at: number): string {
  const raw = src[at].trim();
  return raw.startsWith('• ') ? raw.slice(2).trim() : raw;
}

/**
 * The owner's module paper is MARKDOWN, and she emphasises mid-sentence: element 9's limit sits in
 * it as «الإقرارُ **لا يُسقِط المسؤوليةَ الجزائية**», with the markers INSIDE the phrase. So the
 * comparison strips emphasis from the paper rather than carrying markers into the shipped string.
 * The first version of this spec compared against the raw file and failed — correctly.
 */
function withoutEmphasis(markdown: string): string {
  return markdown.replace(/\*\*/g, '');
}

describe('the declared-act texts are the adviser’s and the owner’s, byte for byte', () => {
  it('the art. 15/d article text is the adviser’s sentence unaltered', () => {
    expect(
      ARTICLE_15_D.articleText,
      'the art. 15/d window text has drifted from docs/answers/legal-counsel-six-items-verbatim.md. It is the ADVISER’S sentence, shown to a person before they admit a regulatory breach, and the record testifies to what they saw — re-slice it rather than retyping it.',
    ).toBe(adviserWindowText(lines(SIX), AT.six.window));
  });

  it('BOTH answer files carry it, identically — so “from docs/answers/” names one text', () => {
    // Measured 2026-11-12: the five-item and six-item files both carry the art. 15/d window and
    // acknowledgement, byte-identical. If they ever diverge, "byte-identical from docs/answers/"
    // stops being a single instruction and somebody has to choose — which is a decision, not a
    // detail, so it fails here rather than being resolved silently by whichever file is read first.
    const six = lines(SIX);
    const five = lines(FIVE);
    expect(adviserWindowText(five, AT.five.window)).toBe(
      adviserWindowText(six, AT.six.window),
    );
    expect(adviserAcknowledgement(five, AT.five.ack)).toBe(
      adviserAcknowledgement(six, AT.six.ack),
    );
  });

  it('the acknowledgement keeps the adviser’s release AND the owner’s limit, in ONE string', () => {
    // ELEMENT 9: «ومعه حدُّه الذي قاله المستشارُ بجانبِه ولا يُفصَل عنه». One string is the only
    // shape that makes "never separated" structural — two fields can be rendered apart, and a
    // template that drops the second would look finished.
    expect(ARTICLE_15_D.acknowledgementText).toContain(
      ARTICLE_15_D_RELEASE_ANCHOR,
    );
    expect(ARTICLE_15_D.acknowledgementText).toContain(ARTICLE_15_D_LIMIT);

    // And it OPENS with the adviser's own sentence: the limit is appended, never interleaved.
    expect(
      ARTICLE_15_D.acknowledgementText.startsWith(
        adviserAcknowledgement(lines(SIX), AT.six.ack),
      ),
      'the composed acknowledgement no longer begins with the adviser’s own sentence — the limit is appended to his text, never woven into it.',
    ).toBe(true);
  });

  it('the release anchor really is the adviser’s, not ours', () => {
    expect(adviserAcknowledgement(lines(SIX), AT.six.ack)).toContain(
      ARTICLE_15_D_RELEASE_ANCHOR,
    );
  });

  it('the limit and the responsibility sentence are the owner’s own words', () => {
    const paper = withoutEmphasis(readFileSync(PAPER, 'utf8'));
    expect(
      paper,
      'the element-9 limit is not in the module paper any more. It is the OWNER’S sentence (§٨.١ item 9) — it is not ours to compose.',
    ).toContain(ARTICLE_15_D_LIMIT);
    expect(
      paper,
      'the responsibility sentence is not in the module paper any more. It is the OWNER’S (§٨.١ item 6).',
    ).toContain(ARTICLE_15_D.responsibilitySentence);
  });

  it('clears the database CHECKs it will be written against', () => {
    // The migration's three `..._is_prose` CHECKs all enforce
    // `DECLARED_ACT_SHOWN_TEXT_MIN_LENGTH`, and `check:declaration-floor` keeps the SQL equal to
    // this constant. A text that cleared this file but not the CHECK would fail at INSERT, inside
    // a request, rather than here.
    for (const text of [
      ARTICLE_15_D.articleText,
      ARTICLE_15_D.acknowledgementText,
      ARTICLE_15_D.responsibilitySentence,
    ]) {
      expect(text.trim().length).toBeGreaterThanOrEqual(
        DECLARED_ACT_SHOWN_TEXT_MIN_LENGTH,
      );
    }
    // And the owner's responsibility sentence is the SHORTEST of the three, which is why the floor
    // is 20 rather than 40: a forty-character floor would refuse her own words.
    expect(ARTICLE_15_D.responsibilitySentence.trim().length).toBeLessThan(40);
  });

  it('the reason floor is the ONE shared floor and not a second ten', () => {
    expect(DECLARED_ACT_REASON_MIN_LENGTH).toBe(10);
    // And it is the shared constant rather than a literal: the source must name the import, not
    // the number. A value comparison passes against a duplicated literal while the duplicate is
    // still correct — which is exactly when one gets written. The art. 11 lesson, one level down.
    const source = readFileSync(
      join(__dirname, 'declared-act.config.ts'),
      'utf8',
    );
    expect(source).toContain('DECLARATION_REASON_MIN_LENGTH');
    expect(
      /DECLARED_ACT_REASON_MIN_LENGTH\s*=\s*\d+/.test(source),
      'the shared floor has been replaced by a literal in declared-act.config.ts. There is one home for that number.',
    ).toBe(false);
  });

  it('⛔ the adviser’s “15 characters” hint is NOT shipped as the floor', () => {
    // His drafted window prints «حد أدنى 15 حرفاً» as the field hint. The owner STRUCK fifteen on
    // 2026-11-11 (decision 129 §5) and ten is the floor everywhere — so shipping that hint would
    // put a false promise on the screen. It is in message 36 §6's table for her.
    const source = readFileSync(
      join(__dirname, 'declared-act.config.ts'),
      'utf8',
    );
    expect(
      source.includes('15 حرف'),
      'the adviser’s “minimum 15 characters” hint has been copied into the config. The enforced floor is TEN (decision 129 §5 struck decision 87 on that point), so that hint would be a false statement on the screen.',
    ).toBe(false);
  });
});
