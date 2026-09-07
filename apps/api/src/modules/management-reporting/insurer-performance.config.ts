import type { InsurerPerformanceScore } from '@ibms/db';
import { Prisma } from '@ibms/db';
import { MONEY_ROUNDING, sumMoney, toMoney } from '../../common/money.util';
import {
  previousUtcMonthRange,
  type PeriodWindow,
} from '../../common/period.util';

// Re-exported so existing `from './insurer-performance.config'` imports
// keep working unchanged — `previousUtcMonthRange`/`PeriodWindow` moved to
// `common/period.util.ts` once `employee-performance.config.ts` needed the
// identical calculation (the `calendar-date.util.ts` promotion precedent).
export { previousUtcMonthRange, type PeriodWindow };

/**
 * Process 60 (backlog Part C #60, Domain G) — "Insurer Performance: a
 * periodic job computing the score from quote-response speed/claims
 * service/price/service quality." Unlike #58/#59, `InsurerPerformanceScore`
 * and `InsurerSlaAgreement` already exist in the core schema — this process
 * is their first real consumer. See `ibms-brain/meta/context/
 * insurer-performance.md` for the full reasoning behind each dimension's
 * metric choice.
 */

/** A score is 0-100, at most 2dp — the `Decimal(5, 2)` column shape (the
 * `comparison.config.ts` `MIN_SCORE`/`MAX_SCORE` precedent). */
export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/** No `InsurerSlaAgreement` (`slaType: 'quote_response'`) has ever been
 * agreed for most insurers — this codebase's dormant-model precedent
 * (`InsurerSlaAgreement` has zero prior readers). Falls back to the SAME
 * 9-day default `RFQ.followUpThresholdDays` already uses (backlog Part C
 * #11) rather than inventing an unrelated number. */
export const DEFAULT_QUOTE_RESPONSE_TARGET_DAYS = 9;

/** A dimension with no computable data this period (e.g. no RFQ sent, no
 * claims notified, no comparable quotes, no subjective service score
 * supplied) gets this neutral midpoint rather than 0 (which would read as
 * "performed badly" for an insurer who simply had no relevant activity) or
 * 100 (which would read as "performed perfectly" on no evidence at all). */
export const NEUTRAL_SCORE = new Prisma.Decimal(50);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface InsurerPerformanceScoreView {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: string;
  claimsServiceScore: string;
  priceScore: string;
  serviceQualityScore: string;
  computedAt: string;
}

/** Pure: clamps a computed score into `[MIN_SCORE, MAX_SCORE]` and rounds to
 * the column's 2dp — a computed ratio (e.g. a much-cheaper-than-average
 * premium) can mathematically land outside the range; a display score never
 * should. */
export function clampScore(value: Prisma.Decimal): Prisma.Decimal {
  return Prisma.Decimal.max(
    MIN_SCORE,
    Prisma.Decimal.min(MAX_SCORE, value),
  ).toDecimalPlaces(2, MONEY_ROUNDING);
}

/** Pure: average response time in days -> a 0-100 score, `targetDays` at
 * the target being 100, scaling down as the average grows past it. `null`
 * (no responded RFQs this period) is the caller's cue to use
 * `NEUTRAL_SCORE` instead of calling this at all. */
export function scoreFromAverageDays(
  averageDays: number,
  targetDays: number,
): Prisma.Decimal {
  if (averageDays <= 0) return new Prisma.Decimal(MAX_SCORE);
  const ratio = new Prisma.Decimal(targetDays)
    .dividedBy(averageDays)
    .times(100);
  return clampScore(ratio);
}

/** Pure: a plain proportion (0-1) -> a 0-100 score. */
export function scoreFromProportion(proportion: number): Prisma.Decimal {
  return clampScore(new Prisma.Decimal(proportion).times(100));
}

/**
 * Pure: this insurer's premium vs. the average of every OTHER insurer's
 * current quote on the same RFQ, as a 0-100 competitiveness score — cheaper
 * than the field's average scores higher, capped at 100 (being cheaper than
 * average is never "more than perfect"). Touches `Quotation.premium` (a
 * `MONEY_DECIMAL_FIELDS` column, money-decimal-jod.md), so this stays in
 * `Prisma.Decimal` via `money.util.ts` end to end — never a raw JS float
 * division of two premiums.
 */
export function priceCompetitivenessScore(
  thisPremium: string,
  otherPremiums: readonly string[],
): Prisma.Decimal {
  const avgOther = sumMoney(otherPremiums).dividedBy(otherPremiums.length);
  const ratio = avgOther.dividedBy(toMoney(thisPremium)).times(100);
  return clampScore(ratio);
}

/** Pure: whole days between two instants, as a plain JS number — never
 * money, so ordinary floating-point division is fine here (the lex's "never
 * a JS float" rule scopes `MONEY_DECIMAL_FIELDS`/`NON_MONEY_DECIMAL_FIELDS`
 * arithmetic, not a day-count derived from two `DateTime` columns). */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export function deriveInsurerPerformanceScoreView(
  row: InsurerPerformanceScore,
): InsurerPerformanceScoreView {
  return {
    id: row.id,
    insurerId: row.insurerId,
    periodLabel: row.periodLabel,
    quoteResponseScore: row.quoteResponseScore.toFixed(2),
    claimsServiceScore: row.claimsServiceScore.toFixed(2),
    priceScore: row.priceScore.toFixed(2),
    serviceQualityScore: row.serviceQualityScore.toFixed(2),
    computedAt: row.computedAt.toISOString(),
  };
}
