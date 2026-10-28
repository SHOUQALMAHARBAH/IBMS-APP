import { BadRequestException } from '@nestjs/common';

/**
 * Process 5 — the structured "what risks do you face" questionnaire and the
 * deterministic mapping from its answers to a recommended coverage list.
 *
 * The question set is a fixed config, not an admin-editable form builder —
 * making the questionnaire itself configurable at runtime is out of scope
 * for this backlog item (see README § Known gaps, Part C #5). The mapping is
 * intentionally pure and rule-based so `deriveRecommendedCoverageLines()`
 * gives the same output for the same answers every time, and so a reviewer
 * (Process 5's approval gate) can reason about why a line was recommended.
 *
 * Coverage-line strings are canonical free text (the schema keeps
 * `NeedsAssessment.recommendedCoverageLines` as `String[]`, not an enum —
 * see the model comment listing the same example lines).
 */

export const COVERAGE_LINES = [
  'Property All Risks (Fire)',
  'Business Interruption',
  'Machinery Breakdown',
  'Burglary',
  'Workers Compensation',
  'Public Liability',
  'Product Liability',
  'Professional Indemnity',
  'Motor Fleet',
  'Marine Cargo / Goods in Transit',
  'Cyber',
  'Group Medical',
  'Group Life',
] as const;

export type CoverageLine = (typeof COVERAGE_LINES)[number];

export type QuestionType = 'boolean' | 'number';

export interface NeedsAssessmentQuestion {
  id: string;
  /** Client-facing prompt — the web form renders these verbatim. */
  prompt: string;
  /**
   * The same question in Arabic — THE OWNER'S OWN WORDS, verbatim.
   *
   * REQUIRED, which is the whole point: the form rendered `{q.prompt}` unconditionally, so an
   * Arabic officer read ENGLISH questions aloud to a Jordanian client on the screen that
   * decides which cover to recommend. No gate caught it — these strings arrive from the API at
   * runtime and `hardcoded-ui-english.py` reads SOURCE, so it cannot see any server-supplied
   * display string. Making this required means a fourteenth question is a COMPILE ERROR until
   * somebody decides its Arabic, rather than one more English question in an Arabic interview.
   *
   * A PAIR ON THE WIRE, not thirteen i18n keys. That is the established shape for bilingual
   * reference DATA here (`InsuranceLineSeed.nameEn`/`nameAr`, `Role`, `Branch`,
   * `DocumentTemplate`), and it leaves nothing to keep in parity — where keys would need a
   * cross-package guard over two lists and would render NOTHING through `t(undefined)` if one
   * were missed. Decision 45 moved `meaning` OFF the wire for the opposite case: an enum whose
   * vocabulary already lived in the i18n tree, where a second copy could drift.
   *
   * PINNED BY HASH in `needs-assessment.config.spec.ts` — her prose, so a reword fails by name.
   */
  promptAr: string;
  type: QuestionType;
}

/** The questionnaire. `id`s are the keys of `NeedsAssessment.questionnaireAnswers`. */
export const NEEDS_ASSESSMENT_QUESTIONS: readonly NeedsAssessmentQuestion[] = [
  {
    id: 'ownsOrLeasesPremises',
    prompt: 'Does the business own or lease commercial premises?',
    promptAr: 'هل يملك النشاطُ مقرّاً تجارياً أو يستأجره؟',
    type: 'boolean',
  },
  {
    id: 'holdsPhysicalStock',
    prompt: 'Does it hold physical stock, inventory or contents of value?',
    promptAr: 'هل يحتفظ بمخزونٍ أو بضاعةٍ أو محتوياتٍ ذاتِ قيمة؟',
    type: 'boolean',
  },
  {
    id: 'revenueDependsOnPremises',
    prompt:
      'Would physical damage to the premises interrupt revenue for a meaningful period?',
    promptAr: 'لو أصاب المقرَّ ضررٌ مادّيّ، هل يتوقّف الدخلُ مدّةً مؤثِّرة؟',
    type: 'boolean',
  },
  {
    id: 'operatesSpecialisedMachinery',
    prompt: 'Does it operate specialised plant or machinery?',
    promptAr: 'هل يشغّل آلاتٍ أو معدّاتٍ متخصّصة؟',
    type: 'boolean',
  },
  {
    id: 'employeeCount',
    prompt: 'How many people does it employ?',
    promptAr: 'كم عددُ العاملين لديه؟',
    type: 'number',
  },
  {
    id: 'publicVisitsPremises',
    prompt: 'Do members of the public or visitors attend its premises?',
    promptAr: 'هل يزور الجمهورُ أو الزوّارُ مقرَّه؟',
    type: 'boolean',
  },
  {
    id: 'manufacturesOrSuppliesProducts',
    prompt: 'Does it manufacture, import, or supply physical products?',
    promptAr: 'هل يصنع أو يستورد أو يورّد منتجاتٍ ماديّة؟',
    type: 'boolean',
  },
  {
    id: 'providesProfessionalAdvice',
    prompt: 'Does it provide professional advice or services for a fee?',
    promptAr: 'هل يقدّم استشاراتٍ أو خدماتٍ مهنيّةً بأجر؟',
    type: 'boolean',
  },
  {
    id: 'operatesVehicleFleet',
    prompt: 'Does it operate a fleet of vehicles?',
    promptAr: 'هل يشغّل أسطولَ مركبات؟',
    type: 'boolean',
  },
  {
    id: 'movesGoodsByTransport',
    prompt: 'Does it move goods by road, sea or air?',
    promptAr: 'هل ينقل بضائعَ برّاً أو بحراً أو جوّاً؟',
    type: 'boolean',
  },
  {
    id: 'handlesPersonalOrPaymentData',
    prompt:
      'Does it hold personal or payment-card data, or depend on IT systems to operate?',
    promptAr:
      'هل يحتفظ ببياناتٍ شخصيةٍ أو بياناتِ بطاقاتِ دفع، أو يعتمد على أنظمةٍ معلوماتيةٍ في عمله؟',
    type: 'boolean',
  },
  {
    id: 'wantsStaffMedicalCover',
    prompt: 'Does it want to provide group medical cover for staff?',
    promptAr: 'هل يرغب بتأمينٍ صحيٍّ جماعيٍّ لموظَّفيه؟',
    type: 'boolean',
  },
  {
    id: 'wantsStaffLifeCover',
    prompt: 'Does it want to provide group life cover for staff?',
    promptAr: 'هل يرغب بتأمينِ حياةٍ جماعيٍّ لموظَّفيه؟',
    type: 'boolean',
  },
] as const;

const QUESTIONS_BY_ID = new Map(
  NEEDS_ASSESSMENT_QUESTIONS.map((q) => [q.id, q]),
);

/** Upper bound on the employee-count answer — a generous ceiling that still
 * catches a fat-fingered value that would otherwise sail through as a valid
 * number. */
const MAX_EMPLOYEE_COUNT = 1_000_000;

export type QuestionnaireAnswers = Record<string, boolean | number>;

/**
 * Validates a raw `questionnaireAnswers` payload against the question set:
 * every question must be answered, every answer must match its question's
 * type, and there must be no unknown keys. Throws `BadRequestException` with
 * a specific message on the first problem — this runs in the service, not as
 * a class-validator decorator, because the shape is driven by
 * `NEEDS_ASSESSMENT_QUESTIONS` rather than a fixed DTO.
 */
export function parseQuestionnaireAnswers(raw: unknown): QuestionnaireAnswers {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadRequestException(
      'questionnaireAnswers must be an object keyed by question id.',
    );
  }
  const input = raw as Record<string, unknown>;

  const unknownKeys = Object.keys(input).filter((k) => !QUESTIONS_BY_ID.has(k));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(
      `questionnaireAnswers has unknown question id(s): ${unknownKeys.join(', ')}`,
    );
  }

  const answers: QuestionnaireAnswers = {};
  for (const question of NEEDS_ASSESSMENT_QUESTIONS) {
    const value = input[question.id];
    if (value === undefined || value === null) {
      throw new BadRequestException(
        `questionnaireAnswers is missing an answer for "${question.id}".`,
      );
    }
    if (question.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `questionnaireAnswers["${question.id}"] must be a boolean.`,
        );
      }
      answers[question.id] = value;
    } else {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > MAX_EMPLOYEE_COUNT
      ) {
        throw new BadRequestException(
          `questionnaireAnswers["${question.id}"] must be a whole number between 0 and ${MAX_EMPLOYEE_COUNT}.`,
        );
      }
      answers[question.id] = value;
    }
  }
  return answers;
}

/** One mapping rule: given the validated answers, does this coverage line apply? */
interface CoverageRule {
  line: CoverageLine;
  applies: (a: QuestionnaireAnswers) => boolean;
}

const isYes = (v: boolean | number | undefined): boolean => v === true;

const COVERAGE_RULES: readonly CoverageRule[] = [
  {
    line: 'Property All Risks (Fire)',
    applies: (a) =>
      isYes(a.ownsOrLeasesPremises) || isYes(a.holdsPhysicalStock),
  },
  {
    line: 'Business Interruption',
    applies: (a) => isYes(a.revenueDependsOnPremises),
  },
  {
    line: 'Machinery Breakdown',
    applies: (a) => isYes(a.operatesSpecialisedMachinery),
  },
  { line: 'Burglary', applies: (a) => isYes(a.holdsPhysicalStock) },
  {
    line: 'Workers Compensation',
    applies: (a) => typeof a.employeeCount === 'number' && a.employeeCount > 0,
  },
  { line: 'Public Liability', applies: (a) => isYes(a.publicVisitsPremises) },
  {
    line: 'Product Liability',
    applies: (a) => isYes(a.manufacturesOrSuppliesProducts),
  },
  {
    line: 'Professional Indemnity',
    applies: (a) => isYes(a.providesProfessionalAdvice),
  },
  { line: 'Motor Fleet', applies: (a) => isYes(a.operatesVehicleFleet) },
  {
    line: 'Marine Cargo / Goods in Transit',
    applies: (a) => isYes(a.movesGoodsByTransport),
  },
  { line: 'Cyber', applies: (a) => isYes(a.handlesPersonalOrPaymentData) },
  { line: 'Group Medical', applies: (a) => isYes(a.wantsStaffMedicalCover) },
  { line: 'Group Life', applies: (a) => isYes(a.wantsStaffLifeCover) },
];

/**
 * Turns validated questionnaire answers into the recommended coverage list.
 * Deterministic and order-stable: lines come out in `COVERAGE_LINES`
 * declaration order regardless of rule evaluation order.
 */
export function deriveRecommendedCoverageLines(
  answers: QuestionnaireAnswers,
): string[] {
  const recommended = new Set(
    COVERAGE_RULES.filter((rule) => rule.applies(answers)).map((r) => r.line),
  );
  return COVERAGE_LINES.filter((line) => recommended.has(line));
}
