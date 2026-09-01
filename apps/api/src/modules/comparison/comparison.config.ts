import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import { MONEY_ROUNDING, toMoney } from '../../common/money.util';

/**
 * Process 14 — Quote Comparison (backlog Part C #14, Domain B). The pure,
 * deterministic core of "build the matrix from every current-version
 * quotation": given the RFQ's current quotes + its insurer shortlist + any
 * subjective scores the Placement Officer supplied, partition the shortlist
 * into { has a current quote → a comparison row } / { DECLINED } / { silent
 * → flagged missing }, and normalise the scores.
 *
 * The comparison is **never price alone**
 * (ibms-brain/meta/context/policy-lifecycle.md § "The rules that aren't
 * obvious"): a row is only a pointer to its `Quotation`, which already
 * carries every objective dimension — premium, deductible, `limits`,
 * `biPeriodMonths`, `liabilityLimit`, `exclusions`, `conditions`,
 * `commissionRatePercent` — so the matrix structurally includes coverage /
 * exclusions / deductibles / limits alongside price. The two subjective
 * dimensions (insurer quality, service) are the optional scores below;
 * there is no Insurer-scoring module yet (narrative Process 61).
 */

/** A subjective score is 0-100, at most 2 decimal places — the
 * `ComparisonMatrixRow.{insurerQualityScore,serviceScore}` `Decimal(5, 2)`
 * columns. */
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

export interface InsurerScoreInput {
  insurerId: string;
  insurerQualityScore?: string | null;
  serviceScore?: string | null;
}

/** One current-version quotation, reduced to what the plan needs. */
export interface QuoteForComparison {
  id: string;
  insurerId: string;
  isCurrentVersion: boolean;
}

/** One RFQ shortlist entry, reduced to what the plan needs. */
export interface ShortlistEntry {
  insurerId: string;
  status: string; // RfqInsurerStatus
}

export interface ComparisonRowPlan {
  quotationId: string;
  insurerQualityScore: Prisma.Decimal | null;
  serviceScore: Prisma.Decimal | null;
}

export interface ComparisonPlan {
  /** One per current-version quotation on the RFQ. */
  rows: ComparisonRowPlan[];
  /** Shortlisted insurer ids with no current quote and status != DECLINED —
   * stored in `ComparisonMatrix.missingInsurers` and flagged in the output. */
  missingInsurerIds: string[];
  /** Shortlisted insurer ids with status DECLINED — surfaced in the output
   * but not stored (the schema has no column; recomputed on read). */
  declinedInsurerIds: string[];
}

function normalizeScore(
  raw: string | null | undefined,
  field: string,
): Prisma.Decimal | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  // A 0-100 subjective score is a ratio, not a monetary amount
  // (money-decimal-jod.md scopes ratios out) — `toMoney` / `MONEY_ROUNDING`
  // are reused here only for the safe `Prisma.Decimal` parse (no JS float)
  // and a fixed 2dp rounding that matches the `Decimal(5, 2)` column, the
  // same way `commissionRatePercent` is handled in quotation.config.ts.
  const value = toMoney(raw, field).toDecimalPlaces(2, MONEY_ROUNDING);
  if (value.lessThan(MIN_SCORE) || value.greaterThan(MAX_SCORE)) {
    throw new UnprocessableEntityException(
      `${field} must be between ${MIN_SCORE} and ${MAX_SCORE}`,
    );
  }
  return value;
}

/**
 * Plans the matrix. Pure: the same inputs always yield the same plan (and
 * the same rejection). Throws 422 when there is nothing to compare, when a
 * score names an insurer with no current quote, or when a score is out of
 * range.
 */
export function planComparison(
  quotations: QuoteForComparison[],
  shortlist: ShortlistEntry[],
  scores: InsurerScoreInput[],
): ComparisonPlan {
  const current = quotations.filter((q) => q.isCurrentVersion);
  if (current.length === 0) {
    throw new UnprocessableEntityException(
      'No current-version quotations to compare — capture at least one quote first.',
    );
  }

  const quotedInsurerIds = new Set(current.map((q) => q.insurerId));

  const scoreByInsurer = new Map<
    string,
    {
      insurerQualityScore: Prisma.Decimal | null;
      serviceScore: Prisma.Decimal | null;
    }
  >();
  for (const score of scores) {
    if (scoreByInsurer.has(score.insurerId)) {
      throw new UnprocessableEntityException(
        `Duplicate score for insurer ${score.insurerId}.`,
      );
    }
    if (!quotedInsurerIds.has(score.insurerId)) {
      throw new UnprocessableEntityException(
        `Insurer ${score.insurerId} has no current quotation on this RFQ — there is no comparison row to score.`,
      );
    }
    scoreByInsurer.set(score.insurerId, {
      insurerQualityScore: normalizeScore(
        score.insurerQualityScore,
        'insurerQualityScore',
      ),
      serviceScore: normalizeScore(score.serviceScore, 'serviceScore'),
    });
  }

  const rows: ComparisonRowPlan[] = current.map((q) => {
    const score = scoreByInsurer.get(q.insurerId);
    return {
      quotationId: q.id,
      insurerQualityScore: score?.insurerQualityScore ?? null,
      serviceScore: score?.serviceScore ?? null,
    };
  });

  const missingInsurerIds: string[] = [];
  const declinedInsurerIds: string[] = [];
  for (const entry of shortlist) {
    if (quotedInsurerIds.has(entry.insurerId)) continue;
    if (entry.status === 'DECLINED') declinedInsurerIds.push(entry.insurerId);
    else missingInsurerIds.push(entry.insurerId);
  }

  return { rows, missingInsurerIds, declinedInsurerIds };
}
