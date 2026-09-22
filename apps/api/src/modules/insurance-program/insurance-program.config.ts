import {
  COVERAGE_LINES,
  type CoverageLine,
} from '../needs-assessment/needs-assessment.config';
import type { SumInsuredSummary } from '../risk-profile/risk-profile.config';

/**
 * Process 7 — Product Recommendation / Program Design (backlog Part C #7,
 * Domain A). The deterministic mapping from an APPROVED Needs Assessment's
 * `recommendedCoverageLines` (Process 5) + the parent Risk Profile's derived
 * Sum Insured (Process 6) to the lines of an `InsuranceProgram`.
 *
 * Same philosophy as needs-assessment.config.ts / risk-profile.config.ts:
 * `assembleProgramLines()` is pure and rule-based, so the same inputs always
 * produce the same program, and a reviewer (or the Placement/Technical
 * Officer finalizing it) can reason about why each line's Sum Insured basis
 * came out the way it did. No arithmetic happens here — the Sum Insured
 * figures were already derived, at fils precision, by
 * `deriveSumInsured()` in risk-profile.config.ts (money.util.ts,
 * ibms-brain/meta/lex/money-decimal-jod.md); this file only *selects* which
 * derived figure, if any, seeds each line.
 *
 * Only Property All Risks and Business Interruption have a Sum Insured basis
 * that the asset survey derives directly. Every other line's basis — a
 * liability indemnity limit, a payroll figure, a per-capita sum assured, a
 * per-vehicle value — is set later, at the RFQ / quotation stage (Process
 * 11+, not built): those lines are assembled with `sumInsuredBasis: null`.
 */

/** Which figure of a `SumInsuredSummary`, if any, seeds a line's `sumInsuredBasis`. */
export type SumInsuredBasisSource = 'property' | 'businessInterruption' | null;

interface CoverageLineMapping {
  /** The canonical `InsuranceProgramLine.insuranceLine` string (see the
   * model comment in schema.prisma for the vocabulary). */
  insuranceLine: string;
  /**
   * The MANAGED catalogue code this coverage is, from the global 32.
   *
   * This is the identity; `insuranceLine` above is the display string that used to be the
   * identity. Added because migration `20261019100000` gave `InsuranceProgramLine` a line FK
   * and then nothing populated it — every row written after that migration was unmapped
   * (IMPROVEMENTS.md § 1.40), because the conversion backfilled the existing rows and left the
   * writers alone.
   *
   * The pairs below are the SAME mapping that migration's table used, deliberately not
   * re-derived: two tables deciding which catalogue line a coverage is would be one more than
   * can be kept in agreement, and the migration's was itself derived from a survey of the real
   * vocabulary on both databases. `insurance-program.config.spec.ts` asserts every code here
   * exists in the seeded catalogue, so a typo or a retired code fails a test rather than
   * silently writing NULL.
   */
  lineCode: string;
  basis: SumInsuredBasisSource;
}

/**
 * The canonical `InsuranceProgramLine.insuranceLine` string for the
 * property line — the only line #7 seeds from `propertySumInsured`, and the
 * one Process 9 (Up-Selling) compares a customer's current asset value
 * against. Exported so up-sell.config.ts references the same literal instead
 * of hand-copying it.
 */
export const PROGRAM_LINE_PROPERTY_ALL_RISKS = 'Property All Risks';

/**
 * One entry per `COVERAGE_LINES` member. `insuranceLine` is deliberately the
 * program-side vocabulary from the `InsuranceProgramLine` model comment,
 * which is close to but not identical to the client-facing coverage-line
 * wording the Needs Assessment uses (e.g. "Property All Risks (Fire)" ->
 * "Property All Risks").
 */
const COVERAGE_LINE_MAPPINGS: Record<CoverageLine, CoverageLineMapping> = {
  'Property All Risks (Fire)': {
    insuranceLine: PROGRAM_LINE_PROPERTY_ALL_RISKS,
    lineCode: 'PROPERTY_ALL_RISKS',
    basis: 'property',
  },
  'Business Interruption': {
    insuranceLine: 'Business Interruption',
    lineCode: 'BUSINESS_INTERRUPTION',
    basis: 'businessInterruption',
  },
  // Machinery Breakdown and Burglary are property-adjacent, but the survey
  // does not break out an equipment-only or stock-only declared value, so
  // there is no honest asset-derived figure to seed them with — set at
  // quotation.
  'Machinery Breakdown': {
    insuranceLine: 'Machinery Breakdown',
    lineCode: 'ENGINEERING_MACHINERY_BREAKDOWN',
    basis: null,
  },
  Burglary: {
    insuranceLine: 'Burglary',
    lineCode: 'BURGLARY_THEFT',
    basis: null,
  },
  'Workers Compensation': {
    insuranceLine: 'Workers Compensation',
    lineCode: 'WORKMEN_COMPENSATION_EMPLOYER_LIABILITY',
    basis: null,
  },
  'Public Liability': {
    insuranceLine: 'Public Liability',
    lineCode: 'PUBLIC_GENERAL_LIABILITY',
    basis: null,
  },
  'Product Liability': {
    insuranceLine: 'Product Liability',
    lineCode: 'PRODUCT_LIABILITY',
    basis: null,
  },
  'Professional Indemnity': {
    insuranceLine: 'Professional Indemnity',
    lineCode: 'PROFESSIONAL_INDEMNITY',
    basis: null,
  },
  // Fleet is sized by vehicle count in the survey; motor Sum Insured is set
  // per vehicle at placement, not as a single program-line figure.
  // MOTOR_COMPREHENSIVE, not MOTOR_TPL_COMPULSORY: a fleet programme line means the
  // comprehensive cover. The fleet-vs-individual distinction is the VARIANT axis
  // (`CommissionAgreement.variant`), which `InsuranceProgramLine` does not carry — the
  // retained `insuranceLine` string is still where "Fleet" is recorded here.
  'Motor Fleet': {
    insuranceLine: 'Motor Fleet',
    lineCode: 'MOTOR_COMPREHENSIVE',
    basis: null,
  },
  'Marine Cargo / Goods in Transit': {
    insuranceLine: 'Marine Cargo / Goods in Transit',
    lineCode: 'MARINE_CARGO',
    basis: null,
  },
  Cyber: { insuranceLine: 'Cyber', lineCode: 'CYBER', basis: null },
  // One MEDICAL_HEALTH line in the catalogue, so group-vs-individual is the variant axis
  // again and not a second line code.
  'Group Medical': {
    insuranceLine: 'Group Medical',
    lineCode: 'MEDICAL_HEALTH',
    basis: null,
  },
  // LIFE_GROUP and LIFE_INDIVIDUAL ARE separate catalogue lines, unlike medical — so this
  // one needs no variant. The catalogue's own asymmetry, not an inconsistency here.
  'Group Life': {
    insuranceLine: 'Group Life',
    lineCode: 'LIFE_GROUP',
    basis: null,
  },
};

/**
 * Every catalogue code the coverage mappings name, for the guard that they all exist.
 *
 * Derived from the table rather than restated, so a mapping added without a code cannot slip
 * past the check. Asserted against the REAL seeded catalogue in
 * `managed-line-writers.e2e-spec.ts` — not in a unit test, because a unit test would have to
 * mock the very list it is checking against.
 */
export const COVERAGE_LINE_CODES: readonly string[] = [
  ...new Set(Object.values(COVERAGE_LINE_MAPPINGS).map((m) => m.lineCode)),
];

const COVERAGE_LINE_SET: ReadonlySet<string> = new Set(COVERAGE_LINES);

/** One assembled line, before it is persisted as an `InsuranceProgramLine`.
 * `sumInsuredBasis` is a fils-precision decimal string (as produced by
 * risk-profile.config's `deriveSumInsured`) or `null` — never a JS number. */
export interface AssembledProgramLine {
  insuranceLine: string;
  /**
   * The managed catalogue CODE, or null for a coverage string with no mapping.
   *
   * Null is reachable only through the `unknown` branch of `assembleProgramLines` — a coverage
   * string that is not a `COVERAGE_LINES` member, which a Needs Assessment never emits but a
   * hand-edited list could. Such a line is carried through rather than dropped (the existing
   * rule), so it lands with the string and no FK, which is the honest outcome: the system does
   * not know which managed line it is, and inventing one would be worse than admitting it.
   */
  lineCode: string | null;
  sumInsuredBasis: string | null;
}

function figureFor(
  source: SumInsuredBasisSource,
  summary: SumInsuredSummary,
): string | null {
  // An empty survey's "0.000" is the absence of a figure, not a real Sum
  // Insured of zero — do not seed a line with it.
  if (source === null || summary.assetCount === 0) return null;
  return source === 'property'
    ? summary.propertySumInsured
    : summary.businessInterruptionSumInsured;
}

/**
 * Assembles the `InsuranceProgramLine`s for a program from an approved Needs
 * Assessment's recommended coverage list and the parent Risk Profile's
 * derived Sum Insured.
 *
 * Deterministic and order-stable: lines come out in `COVERAGE_LINES`
 * declaration order regardless of the order they appear in `coverageLines`.
 * A coverage string that is not a known `COVERAGE_LINES` member (which a
 * Needs Assessment never emits, but a hand-edited list could) is still
 * carried through — as its own `insuranceLine` with a `null` basis — rather
 * than silently dropped, and appended after the known lines.
 */
export function assembleProgramLines(
  coverageLines: readonly string[],
  summary: SumInsuredSummary,
): AssembledProgramLine[] {
  const requested = new Set(coverageLines);

  const known: AssembledProgramLine[] = COVERAGE_LINES.filter((line) =>
    requested.has(line),
  ).map((line) => {
    const mapping = COVERAGE_LINE_MAPPINGS[line];
    return {
      insuranceLine: mapping.insuranceLine,
      lineCode: mapping.lineCode,
      sumInsuredBasis: figureFor(mapping.basis, summary),
    };
  });

  const unknown: AssembledProgramLine[] = [
    ...new Set(coverageLines.filter((line) => !COVERAGE_LINE_SET.has(line))),
  ].map((line) => ({
    insuranceLine: line,
    // No mapping, so no code. See `AssembledProgramLine.lineCode`.
    lineCode: null,
    sumInsuredBasis: null,
  }));

  return [...known, ...unknown];
}
