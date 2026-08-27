import { Prisma } from '@ibms/db';
import {
  applyPercentage,
  compareMoney,
  formatMoney,
  isZeroMoney,
  subtractMoney,
  type MoneyInput,
} from '../../common/money.util';
import { PROGRAM_LINE_PROPERTY_ALL_RISKS } from '../insurance-program/insurance-program.config';

/**
 * Process 9 — Up-Selling (backlog Part C #9, Domain A). The pure, rule-based
 * test for "is this customer materially under-insured on property?" — the
 * same philosophy as cross-sell.config.ts / risk-profile.config.ts: given
 * the two figures, the same inputs always produce the same verdict, and a
 * reviewer can reason about why a customer was (or was not) flagged.
 *
 * The comparison is **property Sum Insured vs. current asset value**, per the
 * backlog wording ("current Sum Insured against updated asset value"):
 *   - currentSumInsured  — Σ of the "Property All Risks" line's
 *     `sumInsuredBasis` over the customer's non-SUPERSEDED Insurance
 *     Programs (Process 7).
 *   - currentAssetValue  — `deriveSumInsured(...).propertySumInsured` over
 *     the customer's whole asset survey (Process 6).
 * Business Interruption (annual gross profit, not asset value) is out of
 * scope here — a BI up-sell on profit growth is a separate concern.
 *
 * All arithmetic runs through money.util.ts (fils precision, Part 3.6 /
 * ibms-brain/meta/lex/money-decimal-jod.md) — never a raw Decimal op, never
 * a JS number.
 */

/**
 * How far the current asset value must exceed the designed Sum Insured
 * before an increase is proposed, as a percentage of the Sum Insured. **A
 * drafted default, not a sourced figure** — 10% is roughly where an
 * "average clause" / condition of average starts to bite on a property
 * claim, but neither IBMS source document names a threshold. Same
 * drafted-default caveat as #8's `BENCHMARK_LINES` and the KYC/EDD SLA
 * durations; revisit when a real underwriting-policy source exists.
 */
export const UNDERINSURANCE_THRESHOLD_PERCENT = '10';

/** The `InsuranceProgramLine.insuranceLine` string an asset-value comparison
 * is meaningful against — #7's property line, the only one it seeds from
 * `propertySumInsured`. Re-exported from insurance-program.config.ts so the
 * two modules can never drift. */
export const PROPERTY_ALL_RISKS_LINE = PROGRAM_LINE_PROPERTY_ALL_RISKS;

export interface UnderinsuranceInput {
  currentSumInsured: MoneyInput;
  currentAssetValue: MoneyInput;
}

export interface UnderinsuranceVerdict {
  /** `currentAssetValue - currentSumInsured`, fixed 3dp string (never negative
   * in a flagged verdict; can be negative/zero otherwise). */
  shortfall: string;
  /** The threshold the shortfall was measured against — `UNDERINSURANCE_THRESHOLD_PERCENT`
   * of `currentSumInsured`, fixed 3dp string. */
  thresholdAmount: string;
  /** True when an increase should be proposed: `currentSumInsured` is
   * non-zero and `shortfall >= thresholdAmount`. */
  isUnderinsured: boolean;
}

/**
 * Decides whether the gap between the designed Sum Insured and the current
 * asset value is large enough to propose an increase. Pure and
 * deterministic.
 *
 * Returns `isUnderinsured: false` when `currentSumInsured` is zero — a zero
 * basis means "no property programme / null line basis", not "genuinely
 * insured for nothing", so there is no honest percentage to measure against
 * (README § Known gaps, Part C #9).
 */
export function assessUnderinsurance(
  input: UnderinsuranceInput,
): UnderinsuranceVerdict {
  const shortfall = subtractMoney(
    input.currentAssetValue,
    input.currentSumInsured,
  );
  const thresholdAmount = isZeroMoney(input.currentSumInsured)
    ? new Prisma.Decimal(0)
    : applyPercentage(
        input.currentSumInsured,
        UNDERINSURANCE_THRESHOLD_PERCENT,
      );

  const isUnderinsured =
    !isZeroMoney(input.currentSumInsured) &&
    compareMoney(shortfall, thresholdAmount) >= 0 &&
    compareMoney(shortfall, 0) > 0;

  return {
    shortfall: formatMoney(shortfall),
    thresholdAmount: formatMoney(thresholdAmount),
    isUnderinsured,
  };
}
