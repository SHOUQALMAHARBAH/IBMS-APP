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
    basis: 'property',
  },
  'Business Interruption': {
    insuranceLine: 'Business Interruption',
    basis: 'businessInterruption',
  },
  // Machinery Breakdown and Burglary are property-adjacent, but the survey
  // does not break out an equipment-only or stock-only declared value, so
  // there is no honest asset-derived figure to seed them with — set at
  // quotation.
  'Machinery Breakdown': { insuranceLine: 'Machinery Breakdown', basis: null },
  Burglary: { insuranceLine: 'Burglary', basis: null },
  'Workers Compensation': {
    insuranceLine: 'Workers Compensation',
    basis: null,
  },
  'Public Liability': { insuranceLine: 'Public Liability', basis: null },
  'Product Liability': { insuranceLine: 'Product Liability', basis: null },
  'Professional Indemnity': {
    insuranceLine: 'Professional Indemnity',
    basis: null,
  },
  // Fleet is sized by vehicle count in the survey; motor Sum Insured is set
  // per vehicle at placement, not as a single program-line figure.
  'Motor Fleet': { insuranceLine: 'Motor Fleet', basis: null },
  'Marine Cargo / Goods in Transit': {
    insuranceLine: 'Marine Cargo / Goods in Transit',
    basis: null,
  },
  Cyber: { insuranceLine: 'Cyber', basis: null },
  'Group Medical': { insuranceLine: 'Group Medical', basis: null },
  'Group Life': { insuranceLine: 'Group Life', basis: null },
};

const COVERAGE_LINE_SET: ReadonlySet<string> = new Set(COVERAGE_LINES);

/** One assembled line, before it is persisted as an `InsuranceProgramLine`.
 * `sumInsuredBasis` is a fils-precision decimal string (as produced by
 * risk-profile.config's `deriveSumInsured`) or `null` — never a JS number. */
export interface AssembledProgramLine {
  insuranceLine: string;
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
      sumInsuredBasis: figureFor(mapping.basis, summary),
    };
  });

  const unknown: AssembledProgramLine[] = [
    ...new Set(coverageLines.filter((line) => !COVERAGE_LINE_SET.has(line))),
  ].map((line) => ({ insuranceLine: line, sumInsuredBasis: null }));

  return [...known, ...unknown];
}
