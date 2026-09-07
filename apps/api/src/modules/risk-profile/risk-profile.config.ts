import { Prisma } from '@ibms/db';
import { addMoney, formatMoney } from '../../common/money.util';

/**
 * Process 6 — Risk Assessment (backlog Part C #6, Domain A). The asset-survey
 * taxonomy and the deterministic derivation of Sum Insured + indemnity
 * period from the captured assets.
 *
 * Same philosophy as needs-assessment.config.ts: the derivation is a pure,
 * rule-based function so the same assets always produce the same Sum
 * Insured, and a reviewer downstream (Placement, assembling the Insurance
 * Program) can reason about why a figure came out the way it did. Every
 * add/subtract runs through money.util.ts (fils precision, Part 3.6 /
 * ibms-brain/meta/lex/money-decimal-jod.md) — never a raw Decimal op, never
 * a JS number.
 *
 * Turning these survey aggregates into per-line `Sum Insured` on an
 * `InsuranceProgramLine` is Process 7 (Product Recommendation / Program
 * Design) — deliberately not built here; see README § Known gaps, Part C #6.
 */

/** Fils-precision decimal string — at most 3 decimal places, no currency
 * symbol or separators ("125000" or "125000.500"). Same shape as the
 * prospect module's MONEY_STRING and what money.util.ts's `toMoney` expects. */
export const MONEY_STRING = /^\d{1,15}(\.\d{1,3})?$/;

export const ASSET_TYPES = [
  'building',
  'equipment',
  'stock',
  'vehicle',
  'other',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Asset types whose `declaredValue` rolls up into the property Sum Insured
 * (Part 3.2 — building/equipment/stock). `other` is included so a declared
 * value is never silently dropped; `vehicle` is excluded — a fleet is sized
 * by count, and motor Sum Insured is set per-vehicle at placement, not here. */
const PROPERTY_ASSET_TYPES: ReadonlySet<string> = new Set([
  'building',
  'equipment',
  'stock',
  'other',
]);

/** The window an indemnity period may sensibly take, in months (1 month … 5
 * years). Anything outside is almost always a data-entry slip — same
 * defensive-ceiling rationale as the needs-assessment employee-count cap. */
export const MIN_INDEMNITY_PERIOD_MONTHS = 1;
export const MAX_INDEMNITY_PERIOD_MONTHS = 60;

/** Ceiling on a per-asset fleet count — a generous bound that still catches
 * a fat-fingered value that would otherwise overflow the INTEGER column. */
export const MAX_FLEET_VEHICLE_COUNT = 1_000_000;

/** The subset of Asset fields the derivation reads. `declaredValue` /
 * `annualGrossProfit` arrive as a `Prisma.Decimal` off a persisted row (or a
 * decimal string, or null) — the money helpers accept all three. */
export interface SurveyableAsset {
  assetType: string;
  declaredValue: Prisma.Decimal | string | null;
  annualGrossProfit: Prisma.Decimal | string | null;
  indemnityPeriodMonths: number | null;
  fleetVehicleCount: number | null;
}

export interface SumInsuredSummary {
  /** Σ `declaredValue` over building/equipment/stock/other — fixed 3dp string. */
  propertySumInsured: string;
  /** Σ `annualGrossProfit` over every asset that declares it — the Business
   * Interruption Sum Insured basis (Part 3.2). Fixed 3dp string. */
  businessInterruptionSumInsured: string;
  /** `propertySumInsured` + `businessInterruptionSumInsured` — fixed 3dp string. */
  totalSumInsured: string;
  /** The longest indemnity period across BI-declaring assets, in months, or
   * `null` when no asset declares annual gross profit. */
  indemnityPeriodMonths: number | null;
  /** Σ `fleetVehicleCount` over vehicle assets. */
  fleetVehicleCount: number;
  /** How many assets fed this summary — `0` means "survey not started". */
  assetCount: number;
}

function sumMoneyStrings(
  values: readonly (Prisma.Decimal | string)[],
): Prisma.Decimal {
  return values.length > 0 ? addMoney(...values) : new Prisma.Decimal(0);
}

/**
 * Derives the Sum Insured basis and indemnity period for one site's survey.
 * Deterministic: the same asset set always yields the same summary.
 */
export function deriveSumInsured(
  assets: readonly SurveyableAsset[],
): SumInsuredSummary {
  const propertyValues = assets
    .filter(
      (a) => PROPERTY_ASSET_TYPES.has(a.assetType) && a.declaredValue != null,
    )
    .map((a) => a.declaredValue as Prisma.Decimal | string);

  const biValues = assets
    .filter((a) => a.annualGrossProfit != null)
    .map((a) => a.annualGrossProfit as Prisma.Decimal | string);

  const propertySumInsured = sumMoneyStrings(propertyValues);
  const businessInterruptionSumInsured = sumMoneyStrings(biValues);
  const totalSumInsured = addMoney(
    propertySumInsured,
    businessInterruptionSumInsured,
  );

  const indemnityPeriods = assets
    .filter(
      (a) => a.annualGrossProfit != null && a.indemnityPeriodMonths != null,
    )
    .map((a) => a.indemnityPeriodMonths as number);

  const fleetVehicleCount = assets
    .filter((a) => a.assetType === 'vehicle')
    .reduce((sum, a) => sum + (a.fleetVehicleCount ?? 0), 0);

  return {
    propertySumInsured: formatMoney(propertySumInsured),
    businessInterruptionSumInsured: formatMoney(businessInterruptionSumInsured),
    totalSumInsured: formatMoney(totalSumInsured),
    indemnityPeriodMonths: indemnityPeriods.length
      ? Math.max(...indemnityPeriods)
      : null,
    fleetVehicleCount,
    assetCount: assets.length,
  };
}

export interface SiteSurvey {
  riskProfileId: string;
  siteLabel: string | null;
  summary: SumInsuredSummary;
}

export interface ConsolidatedSurvey {
  customerId: string;
  sites: SiteSurvey[];
  /** Σ across every site — the figure a multi-site client's single
   * consolidated Insurance Program is built from (Part 3.2). Program
   * assembly itself is Process 7. */
  consolidated: {
    propertySumInsured: string;
    businessInterruptionSumInsured: string;
    totalSumInsured: string;
    /** Longest indemnity period across all sites. */
    indemnityPeriodMonths: number | null;
    fleetVehicleCount: number;
    siteCount: number;
  };
}

/**
 * Rolls a multi-site client's per-site surveys into one consolidated Sum
 * Insured view (Part 3.2 — "Repeat per location ... consolidated into one
 * Insurance Program").
 */
export function consolidateSites(
  customerId: string,
  sites: readonly SiteSurvey[],
): ConsolidatedSurvey {
  const rollUp = (pick: (s: SumInsuredSummary) => string): string =>
    formatMoney(sumMoneyStrings(sites.map((s) => pick(s.summary))));

  const periods = sites
    .map((s) => s.summary.indemnityPeriodMonths)
    .filter((m): m is number => m != null);

  return {
    customerId,
    sites: [...sites],
    consolidated: {
      propertySumInsured: rollUp((s) => s.propertySumInsured),
      businessInterruptionSumInsured: rollUp(
        (s) => s.businessInterruptionSumInsured,
      ),
      totalSumInsured: rollUp((s) => s.totalSumInsured),
      indemnityPeriodMonths: periods.length ? Math.max(...periods) : null,
      fleetVehicleCount: sites.reduce(
        (n, s) => n + s.summary.fleetVehicleCount,
        0,
      ),
      siteCount: sites.length,
    },
  };
}
