import { describe, expect, it } from 'vitest';
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
