import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import {
  addMoney,
  applyPercentage,
  compareMoney,
  formatMoney,
  toMoney,
  MONEY_ROUNDING,
  type MoneyInput,
} from '../../common/money.util';

/**
 * Process 16 — Broker Recommendation (backlog Part C #16, Domain B). The
 * pure, deterministic core: validate the documented rationale, and run the
 * conflict-of-interest heuristic. No I/O — the same inputs always yield the
 * same result (and the same rejection).
 */

/** The six rationale dimensions the backlog enumerates. A drafted
 * recommendation must carry a non-empty note for every one of them — the
 * "never price alone" controls rule (Part 3.3, carried from #14). */
export const RATIONALE_FACTOR_KEYS = [
  'coverage',
  'price',
  'financialStrength',
  'claimsService',
  'deductible',
  'policyConditions',
] as const;

export type RationaleFactorKey = (typeof RATIONALE_FACTOR_KEYS)[number];
export type RationaleFactors = Record<RationaleFactorKey, string>;

/** A rationale factor note must say something — a single word is not a
 * documented reason. Same spirit as the quotation `premium > 0` check. */
const MIN_FACTOR_NOTE_LENGTH = 3;
/** The overall summary is required and must be more than a stray word. */
const MIN_RATIONALE_LENGTH = 10;

export interface RecommendationRationaleInput {
  rationale?: string | null;
  /** Whatever the DTO carried — validated key-by-key below. */
  rationaleFactors?: unknown;
}

export interface NormalizedRecommendationRationale {
  rationale: string;
  rationaleFactors: RationaleFactors;
}

/**
 * Validates and trims the recommendation's documented rationale, or throws a
 * 422 naming the offending part. Every one of `RATIONALE_FACTOR_KEYS` must be
 * present with a non-blank note; unknown keys are rejected (so a typo like
 * `finanicalStrength` is caught rather than silently dropped).
 */
export function normalizeRecommendationRationale(
  input: RecommendationRationaleInput,
): NormalizedRecommendationRationale {
  const rationale = (input.rationale ?? '').trim();
  if (rationale.length < MIN_RATIONALE_LENGTH) {
    throw new UnprocessableEntityException(
      `rationale must be a written summary of at least ${MIN_RATIONALE_LENGTH} characters`,
    );
  }

  if (
    input.rationaleFactors === null ||
    typeof input.rationaleFactors !== 'object'
  ) {
    throw new UnprocessableEntityException(
      `rationaleFactors must be an object with a note for each of ${RATIONALE_FACTOR_KEYS.join(', ')}`,
    );
  }
  const factorsIn = input.rationaleFactors as Record<string, unknown>;
  const unexpected = Object.keys(factorsIn).filter(
    (k) => !(RATIONALE_FACTOR_KEYS as readonly string[]).includes(k),
  );
  if (unexpected.length > 0) {
    throw new UnprocessableEntityException(
      `rationaleFactors has unknown key(s): ${unexpected.join(', ')} — expected exactly ${RATIONALE_FACTOR_KEYS.join(', ')}`,
    );
  }

  const factors = {} as RationaleFactors;
  for (const key of RATIONALE_FACTOR_KEYS) {
    const raw = factorsIn[key];
    if (typeof raw !== 'string' || raw.trim().length < MIN_FACTOR_NOTE_LENGTH) {
      throw new UnprocessableEntityException(
        `rationaleFactors.${key} must be a non-empty note (at least ${MIN_FACTOR_NOTE_LENGTH} characters) — the recommendation must address ${key}, not just price`,
      );
    }
    factors[key] = raw.trim();
  }

  return { rationale, rationaleFactors: factors };
}

// --- Conflict of interest -------------------------------------------------

/**
 * A competing quote counts as "comparable" (an offer the broker could
 * realistically have recommended instead) when its premium is no more than
 * this percentage above the recommended quote's premium. A materially more
 * expensive quote is not a "comparable/better-value competing offer"
 * (policy-lifecycle.md § "The rules that aren't obvious").
 *
 * DRAFT, UNSOURCED — no CBJ / Part-3.3 document specifies the band; this is
 * an `ibms-app` product decision (same status as #9's 10% under-insurance
 * threshold and #13's BI-period ceiling). Recorded in
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't
 * obvious" (filed via `/brain-gap` at Part C #16) — replace with a real
 * market-practice figure when one surfaces.
 */
export const COI_COMPARABLE_PREMIUM_BAND_PERCENT = 10;

/**
 * "Materially higher commission": the recommended insurer's commission rate
 * exceeds the best comparable competitor's by at least this many percentage
 * points. Absolute percentage-point difference, not a ratio — a predictable
 * gate.
 *
 * DRAFT, UNSOURCED — same status as the band above; recorded in the same
 * `policy-lifecycle.md` § "The rules that aren't obvious" `/brain-gap`.
 */
export const COI_MATERIAL_COMMISSION_DIFF_POINTS = 2;

/** A quote as the COI heuristic sees it. `commissionRatePercent` /
 * `premium` are decimal strings or `Prisma.Decimal` (whatever the caller
 * has). `commissionRatePercent` null = the insurer did not quote a rate. */
export interface CoiQuote {
  id: string;
  insurerId: string;
  premium: MoneyInput;
  commissionRatePercent: MoneyInput | null;
}

export interface CoiResult {
  flagged: boolean;
  /** The comparable competitor whose materially-lower commission triggered
   * the flag — `null` when not flagged. */
  competingQuotationId: string | null;
  /** recommended rate − competitor rate, 2dp string — `null` when not flagged. */
  commissionDiffPercent: string | null;
}

/** Percentage-rate subtraction: a commission rate is a ratio, not a stored
 * JOD amount, so it does not go through `subtractMoney` (fils scale). It
 * still uses `toMoney` for an exact Decimal parse and the codebase's one
 * fixed rounding mode, quantized to the `@db.Decimal(5, 2)` scale — same
 * reuse `comparison.config.ts`'s `normalizeScore` makes. */
function rateMinus(a: MoneyInput, b: MoneyInput): Prisma.Decimal {
  return toMoney(a, 'coiRate')
    .minus(toMoney(b, 'coiRate'))
    .toDecimalPlaces(2, MONEY_ROUNDING);
}

/**
 * The automatic conflict-of-interest check (backlog Part C #16 requirement
 * 3). Flags when the recommended quote's insurer earns a materially higher
 * commission rate than a *comparable* competing quote (one priced within
 * `COI_COMPARABLE_PREMIUM_BAND_PERCENT` of the recommended premium).
 *
 *   - `recommended.commissionRatePercent` unknown → cannot assess → not
 *     flagged (documented gap: capture the rate at #13 to enable the check).
 *   - No comparable competitor with a known rate → not flagged.
 *   - Otherwise: take the comparable competitor with the LOWEST commission
 *     rate (tie-break: lowest premium, then id — deterministic); flag when
 *     `recommendedRate − thatRate >= COI_MATERIAL_COMMISSION_DIFF_POINTS`.
 *
 * `competitors` must already exclude the recommended quote and be limited to
 * current-version quotes on the same Opportunity.
 */
export function detectConflictOfInterest(
  recommended: CoiQuote,
  competitors: readonly CoiQuote[],
): CoiResult {
  const notFlagged: CoiResult = {
    flagged: false,
    competingQuotationId: null,
    commissionDiffPercent: null,
  };

  if (recommended.commissionRatePercent == null) return notFlagged;

  // premium ceiling for "comparable" = recommended premium + band%
  const ceiling = addMoney(
    recommended.premium,
    applyPercentage(recommended.premium, COI_COMPARABLE_PREMIUM_BAND_PERCENT),
  );

  const comparable = competitors
    .filter(
      (c) =>
        c.commissionRatePercent != null &&
        compareMoney(c.premium, ceiling) <= 0,
    )
    .sort((a, b) => {
      const byRate = compareMoney(
        a.commissionRatePercent as MoneyInput,
        b.commissionRatePercent as MoneyInput,
      );
      if (byRate !== 0) return byRate;
      const byPremium = compareMoney(a.premium, b.premium);
      if (byPremium !== 0) return byPremium;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const best = comparable[0];
  if (!best) return notFlagged;

  const diff = rateMinus(
    recommended.commissionRatePercent,
    best.commissionRatePercent as MoneyInput,
  );
  if (compareMoney(diff, COI_MATERIAL_COMMISSION_DIFF_POINTS) < 0) {
    return notFlagged;
  }

  return {
    flagged: true,
    competingQuotationId: best.id,
    commissionDiffPercent: diff.toFixed(2),
  };
}

/** recommended rate − a *specific* competitor's rate, 2dp string. For the
 * disclosure step when the discloser overrode `competingQuotationId`. */
export function commissionDiffAgainst(
  recommendedRatePercent: MoneyInput,
  competitorRatePercent: MoneyInput,
): string {
  return rateMinus(recommendedRatePercent, competitorRatePercent).toFixed(2);
}

// --- Approval gate ------------------------------------------------------

/**
 * The senior-officer approval gate (backlog Part C #16 requirement 2): the
 * recommended quote's premium exceeds the Opportunity's configurable
 * `targetPremiumThreshold`. No threshold set → never required.
 */
export function approvalRequired(
  recommendedPremium: MoneyInput,
  targetPremiumThreshold: MoneyInput | null,
): boolean {
  if (targetPremiumThreshold == null) return false;
  return compareMoney(recommendedPremium, targetPremiumThreshold) > 0;
}

// --- Audit snapshot ---------------------------------------------------

/**
 * Metadata + money + gate flags for an `AuditLogEntry.afterValue`.
 * Deliberately excludes the free-text `rationale` / `rationaleFactors` notes
 * (the broker's professional reasoning — Confidential, Part 6.1; carried as
 * presence booleans, same "metadata not body" shape as #12 / #13 / #15).
 */
export function recommendationAuditSnapshot(row: {
  opportunityId: string;
  recommendedQuotationId: string;
  draftedByUserId: string;
  approvalRequired: boolean;
  conflictOfInterestFlagged: boolean;
  coiCompetingQuotationId: string | null;
  coiCommissionDiffPercent: Prisma.Decimal | null;
  rationale: string;
  rationaleFactors: unknown;
}): Prisma.InputJsonObject {
  const factorKeys =
    row.rationaleFactors && typeof row.rationaleFactors === 'object'
      ? Object.keys(row.rationaleFactors)
      : [];
  return {
    opportunityId: row.opportunityId,
    recommendedQuotationId: row.recommendedQuotationId,
    draftedByUserId: row.draftedByUserId,
    approvalRequired: row.approvalRequired,
    conflictOfInterestFlagged: row.conflictOfInterestFlagged,
    coiCompetingQuotationId: row.coiCompetingQuotationId,
    coiCommissionDiffPercent:
      row.coiCommissionDiffPercent === null
        ? null
        : row.coiCommissionDiffPercent.toFixed(2),
    hasRationale: row.rationale.trim().length > 0,
    rationaleFactorsComplete: RATIONALE_FACTOR_KEYS.every((k) =>
      factorKeys.includes(k),
    ),
  };
}

/** Money as a fixed 3dp string (re-export of the util for the service /
 * view layer, so a caller never re-implements formatting). */
export { formatMoney };
