import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  COVERAGE_LINES,
  NEEDS_ASSESSMENT_QUESTIONS,
  deriveRecommendedCoverageLines,
  parseQuestionnaireAnswers,
  type QuestionnaireAnswers,
} from './needs-assessment.config';

/** A fully-negative answer set — every boolean false, zero employees. Spread
 * and override per test. */
function noAnswers(): Record<string, boolean | number> {
  const answers: Record<string, boolean | number> = {};
  for (const q of NEEDS_ASSESSMENT_QUESTIONS) {
    answers[q.id] = q.type === 'number' ? 0 : false;
  }
  return answers;
}

describe('parseQuestionnaireAnswers', () => {
  it('accepts a complete, well-typed answer set and returns it normalised', () => {
    const parsed = parseQuestionnaireAnswers(noAnswers());
    expect(Object.keys(parsed).sort()).toEqual(
      NEEDS_ASSESSMENT_QUESTIONS.map((q) => q.id).sort(),
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => parseQuestionnaireAnswers([])).toThrow(BadRequestException);
    expect(() => parseQuestionnaireAnswers('nope')).toThrow(
      BadRequestException,
    );
    expect(() => parseQuestionnaireAnswers(null)).toThrow(BadRequestException);
  });

  it('rejects a missing answer', () => {
    const answers = noAnswers();
    delete answers.publicVisitsPremises;
    expect(() => parseQuestionnaireAnswers(answers)).toThrow(
      /missing an answer for "publicVisitsPremises"/,
    );
  });

  it('rejects an unknown question id', () => {
    expect(() =>
      parseQuestionnaireAnswers({ ...noAnswers(), notAQuestion: true }),
    ).toThrow(/unknown question id\(s\): notAQuestion/);
  });

  it('rejects a boolean question answered with a non-boolean', () => {
    expect(() =>
      parseQuestionnaireAnswers({
        ...noAnswers(),
        ownsOrLeasesPremises: 'yes',
      }),
    ).toThrow(/must be a boolean/);
  });

  it('rejects a number question answered with a negative, fractional, or over-large value', () => {
    for (const bad of [-1, 2.5, 5_000_000]) {
      expect(() =>
        parseQuestionnaireAnswers({ ...noAnswers(), employeeCount: bad }),
      ).toThrow(/whole number between 0 and/);
    }
  });
});

describe('deriveRecommendedCoverageLines', () => {
  it('recommends nothing for an all-negative answer set', () => {
    expect(
      deriveRecommendedCoverageLines(noAnswers() as QuestionnaireAnswers),
    ).toEqual([]);
  });

  it('maps premises + stock to Property All Risks and Burglary (and does not duplicate Property)', () => {
    const lines = deriveRecommendedCoverageLines({
      ...noAnswers(),
      ownsOrLeasesPremises: true,
      holdsPhysicalStock: true,
    });
    expect(lines).toContain('Property All Risks (Fire)');
    expect(lines).toContain('Burglary');
    expect(lines.filter((l) => l === 'Property All Risks (Fire)')).toHaveLength(
      1,
    );
  });

  it('maps a positive employee count (not a boolean) to Workers Compensation', () => {
    expect(
      deriveRecommendedCoverageLines({
        ...noAnswers(),
        employeeCount: 12,
      }),
    ).toContain('Workers Compensation');
    expect(
      deriveRecommendedCoverageLines({
        ...noAnswers(),
        employeeCount: 0,
      }),
    ).not.toContain('Workers Compensation');
  });

  it('maps each single risk answer to its coverage line', () => {
    const cases: Array<[string, string]> = [
      ['revenueDependsOnPremises', 'Business Interruption'],
      ['operatesSpecialisedMachinery', 'Machinery Breakdown'],
      ['publicVisitsPremises', 'Public Liability'],
      ['manufacturesOrSuppliesProducts', 'Product Liability'],
      ['providesProfessionalAdvice', 'Professional Indemnity'],
      ['operatesVehicleFleet', 'Motor Fleet'],
      ['movesGoodsByTransport', 'Marine Cargo / Goods in Transit'],
      ['handlesPersonalOrPaymentData', 'Cyber'],
      ['wantsStaffMedicalCover', 'Group Medical'],
      ['wantsStaffLifeCover', 'Group Life'],
    ];
    for (const [answerKey, line] of cases) {
      expect(
        deriveRecommendedCoverageLines({
          ...noAnswers(),
          [answerKey]: true,
        }),
      ).toEqual([line]);
    }
  });

  it('returns lines in COVERAGE_LINES declaration order regardless of which answers were set', () => {
    const lines = deriveRecommendedCoverageLines({
      ...noAnswers(),
      wantsStaffLifeCover: true,
      ownsOrLeasesPremises: true,
      handlesPersonalOrPaymentData: true,
    });
    const expectedOrder = COVERAGE_LINES.filter((l) => lines.includes(l));
    expect(lines).toEqual(expectedOrder);
  });
});

/*
 * THE THIRTEEN ARABIC PROMPTS — the owner's own words, and the defect they close.
 *
 * `NEEDS_ASSESSMENT_QUESTIONS` carried English prompts and both render sites printed them
 * unconditionally, so an Arabic officer read ENGLISH questions aloud to a Jordanian client on
 * the screen that decides which cover to recommend.
 *
 * NO GATE COULD SEE IT, and that is worth one line of its own: these strings arrive from the
 * API at runtime, and `hardcoded-ui-english.py` reads SOURCE. It is therefore blind to EVERY
 * server-supplied display string in this product, not just these — the questionnaire is the
 * instance that was found, not the class.
 */
describe('the risk questionnaire reads in Arabic', () => {
  it('every question carries a non-empty Arabic prompt, and they are all distinct', () => {
    // TOTALITY is what the REQUIRED field buys at compile time; this is the runtime half —
    // `promptAr: ''` would type-check perfectly and render an empty legend.
    expect(NEEDS_ASSESSMENT_QUESTIONS).toHaveLength(13);
    for (const q of NEEDS_ASSESSMENT_QUESTIONS) {
      expect(q.promptAr.trim(), `${q.id} has no Arabic prompt`).not.toBe('');
      // An Arabic letter, not merely a non-empty string: the English prompt copied across
      // would satisfy a length check and is exactly the defect being closed.
      expect(
        /[\u0620-\u064A]/.test(q.promptAr),
        `${q.id}'s Arabic prompt carries no Arabic letter`,
      ).toBe(true);
      expect(q.promptAr, `${q.id}'s Arabic prompt is the English one`).not.toBe(
        q.prompt,
      );
    }
    // DISTINCTNESS catches the realistic mistake: one prompt pasted under two ids.
    expect(
      new Set(NEEDS_ASSESSMENT_QUESTIONS.map((q) => q.promptAr)).size,
    ).toBe(13);
  });

  it('every Arabic prompt is NFC', () => {
    /*
     * The shadda/vowel-order trap, which has cost this repository three positions once before:
     * `U+0651` before a vowel and after it render IDENTICALLY and compare UNEQUAL, so a
     * retyped prompt can look right and fail every comparison — including the digest below,
     * which would then be impossible to diagnose from its message alone.
     */
    for (const q of NEEDS_ASSESSMENT_QUESTIONS) {
      expect(q.promptAr.normalize('NFC'), `${q.id} is not NFC`).toBe(
        q.promptAr,
      );
    }
  });

  it('the set is byte-identical to what the owner supplied', () => {
    /*
     * HER PROSE, PINNED — the `dpoAssignNotice` treatment. These thirteen are the owner's own
     * words, not a slice of a shipping string and not a draft adopted from a measured meaning,
     * so the thing to protect is the BYTES. A changed digest means somebody reworded a question
     * a client is asked, which is hers to do and nobody else's.
     *
     * NUL-joined because NUL cannot occur in the text: two different groupings of the same
     * thirteen strings therefore cannot collide on one digest, which a space-joined hash
     * could not promise.
     */
    const digest = createHash('sha256')
      .update(
        NEEDS_ASSESSMENT_QUESTIONS.map((q) => q.promptAr)
          .join('\u0000')
          .normalize('NFC'),
        'utf8',
      )
      .digest('hex');
    expect(
      digest,
      "an Arabic questionnaire prompt was reworded — that text is the owner's, so restore it or have her re-supply it and move this digest deliberately",
    ).toBe('b4bc3e628ee7681b4fa84b0bb3cce4d9d9d733f47b1837e0da123cd36c4adbe1');
  });
});
