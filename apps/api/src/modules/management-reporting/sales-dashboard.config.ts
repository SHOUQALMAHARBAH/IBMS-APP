import { addMoney, formatMoney, formatMoneySum } from '../../common/money.util';
import type { MoneyInput } from '../../common/money.util';
import type { FigureScope, PeriodWindow } from '../../common/period.util';

/**
 * Part E — Dashboards & Management Reporting (Part 13), backlog Process
 * #64 "Executive Management Reporting — Part E below." The Sales Dashboard
 * bullet: "new leads and conversion rate, premium written (new vs.
 * renewal), commission income, cross-sell/up-sell opportunity conversion."
 *
 * `dashboard.sales.view` was already pre-seeded (`[SALES_RELATIONSHIP_
 * OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`) and is
 * ALREADY consumed by backlog #59's own `GET /sales-performance`
 * (quota-vs-actual `newProspects` tracking against a `SalesTarget`) —
 * that endpoint is deliberately left untouched. This is a SEPARATE,
 * broader endpoint (`GET /dashboards/sales`) sharing the same permission
 * code on purpose (both are genuinely "the sales dashboard" from an
 * access-control point of view), the same way #59-63's five department
 * dashboards and #64's executive one all reuse pre-seeded `dashboard.*`
 * codes rather than this process inventing new ones. Reads every
 * underlying table directly — no cross-module service dependency, the
 * #58 KPI Dashboard / #43 SLA Dashboard shape
 * (`ibms-brain/meta/context/kpi-dashboard.md`).
 *
 * **Filter applicability is real, not uniform** — Part E's cross-cutting
 * rule ("every dashboard filterable by branch/line of business/insurer/
 * time period") is honored per-metric only where the dimension actually
 * exists on the underlying model: `branchId` resolves to the concrete
 * `User.branchId` set and scopes leads (`Lead.ownerUserId`) and premium/
 * commission (`Policy.placedByUserId`) — it does NOT scope cross-sell/
 * up-sell (system-detected against a `Customer`, no officer-ownership
 * concept). `insuranceLine` scopes premium/commission
 * (`Policy.insuranceLine`) and cross-sell (`CrossSellOpportunity.gapLine`
 * is itself a line) — NOT leads (a Lead has no line yet) or up-sell (a
 * Sum-Insured gap, not a line). `insurerId` scopes only premium/commission
 * (`Policy.insurerId`) — nothing pre-placement has an insurer yet. `period`
 * (default: the previous UTC calendar month, the #59-61 precedent) applies
 * to every metric via its own date field (`Lead.createdAt`,
 * `Policy.createdAt`, `CommissionLedgerEntry.createdAt`,
 * `CrossSellOpportunity.detectedAt`, `UpSellRecommendation.detectedAt`).
 *
 * **"Premium written (new vs. renewal)"** splits on `Opportunity.isRenewal`
 * (a real boolean already on the schema) via a relation filter in two
 * separate `Policy.aggregate()` calls — a genuine DB-side sum, not a
 * capped `findMany` reduced in JS.
 */

export interface LeadsMetric {
  newLeadsCount: number;
  convertedToProspectCount: number;
  /** NULL when the cohort is empty — there is no rate, rather than a rate of zero. */
  conversionRatePercent: number | null;
}

export interface PremiumWrittenMetric {
  newJod: string;
  renewalJod: string;
  totalJod: string;
}

export interface ConversionMetric {
  totalCount: number;
  convertedCount: number;
  /** NULL when the cohort is empty — there is no rate, rather than a rate of zero. */
  conversionRatePercent: number | null;
}

export interface SalesDashboardSummary {
  generatedAt: string;
  /** Owner decision 58 — which figures the period above actually describes.
   *  A screen renders the period clause beside a `'period'` metric and an AS-OF
   *  clause beside an `'asOf'` one; it must never decide this for itself. */
  metricScope: typeof SALES_DASHBOARD_METRIC_SCOPE;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  leads: LeadsMetric;
  premiumWritten: PremiumWrittenMetric;
  commissionIncomeJod: string;
  crossSell: ConversionMetric;
  upSell: ConversionMetric;
}

/**
 * Pure: a percentage rounded to 2dp, and **NULL when there is nothing to convert from**.
 *
 * ~~0 (not NaN) when there is nothing to convert from — an empty cohort has a 0% conversion rate, not
 * undefined.~~ **That position is reversed, on the owner's ruling (item 5 batch 1).** An empty cohort has
 * NO conversion rate. Two reasons, and the first is the one that decided it:
 *
 *   0% IS A CLAIM ABOUT PERFORMANCE WHERE NO PERFORMANCE WAS MEASURED. On the employee-performance
 *   screens this number sits beside a person's NAME and reads as a judgement of them rather than as "no
 *   data". The system must not describe an employee who received no leads as having converted none of
 *   them. Same principle as the access-recertification record: do not report "there was nothing to do" in
 *   the shape of "it was done badly".
 *
 *   AND A ZERO ENTERS AN AVERAGE WHERE A NULL DOES NOT. The moment anyone means conversion across
 *   employees, or charts it, the substituted zeros drag the figure down — and the denominator displayed
 *   beside each one on the screen saves nobody downstream.
 *
 * `employee-performance`, `sales-performance` and `dashboards/insurer-employee-performance` already
 * rendered `null` as an em dash; this makes the sales and executive dashboards agree with them rather than
 * having two conventions for one concept.
 */
export function computeConversionRatePercent(
  convertedCount: number,
  totalCount: number,
): number | null {
  if (totalCount === 0) return null;
  return Math.round((convertedCount / totalCount) * 10000) / 100;
}

export function deriveLeadsMetric(
  newLeadsCount: number,
  convertedToProspectCount: number,
): LeadsMetric {
  return {
    newLeadsCount,
    convertedToProspectCount,
    conversionRatePercent: computeConversionRatePercent(
      convertedToProspectCount,
      newLeadsCount,
    ),
  };
}

export function deriveConversionMetric(
  totalCount: number,
  convertedCount: number,
): ConversionMetric {
  return {
    totalCount,
    convertedCount,
    conversionRatePercent: computeConversionRatePercent(
      convertedCount,
      totalCount,
    ),
  };
}

export function derivePremiumWrittenMetric(
  newSum: MoneyInput | null,
  renewalSum: MoneyInput | null,
): PremiumWrittenMetric {
  const newJod = formatMoneySum(newSum);
  const renewalJod = formatMoneySum(renewalSum);
  const totalJod = formatMoney(addMoney(newSum ?? 0, renewalSum ?? 0));
  return { newJod, renewalJod, totalJod };
}

/**
 * EVERY METRIC ON THIS SCREEN OBEYS THE PERIOD, and it is declared rather than
 * assumed. This file's own header already states it — the period «applies to every
 * metric via its own date field (`Lead.createdAt`, `Policy.createdAt`,
 * `CommissionLedgerEntry.createdAt`, `CrossSellOpportunity.detectedAt`,
 * `UpSellRecommendation.detectedAt`)» — so all five values here are `'period'`.
 *
 * A UNIFORM MAP IS STILL WORTH SHIPPING, because the sibling dashboard proves the
 * asymmetry is a real design choice in this codebase rather than a hypothetical:
 * `/dashboards/policy` has two snapshot metrics. If a metric here ever became a
 * snapshot, a screen that had assumed uniformity would keep printing a period beside
 * it and nothing would say otherwise.
 *
 * `satisfies` with the key union spelled out makes a sixth metric a COMPILE ERROR
 * here rather than a figure that silently renders no clause at all.
 */
export const SALES_DASHBOARD_METRIC_SCOPE = {
  leads: 'period',
  premiumWritten: 'period',
  commissionIncomeJod: 'period',
  crossSell: 'period',
  upSell: 'period',
} as const satisfies Record<
  'leads' | 'premiumWritten' | 'commissionIncomeJod' | 'crossSell' | 'upSell',
  FigureScope
>;

export function buildSalesDashboardSummary(input: {
  now: Date;
  period: PeriodWindow;
  newLeadsCount: number;
  convertedToProspectCount: number;
  newPremiumSum: MoneyInput | null;
  renewalPremiumSum: MoneyInput | null;
  commissionSum: MoneyInput | null;
  crossSellTotal: number;
  crossSellConverted: number;
  upSellTotal: number;
  upSellConverted: number;
}): SalesDashboardSummary {
  return {
    generatedAt: input.now.toISOString(),
    periodLabel: input.period.periodLabel,
    periodStart: input.period.periodStart.toISOString(),
    periodEnd: input.period.periodEnd.toISOString(),
    metricScope: SALES_DASHBOARD_METRIC_SCOPE,
    leads: deriveLeadsMetric(
      input.newLeadsCount,
      input.convertedToProspectCount,
    ),
    premiumWritten: derivePremiumWrittenMetric(
      input.newPremiumSum,
      input.renewalPremiumSum,
    ),
    commissionIncomeJod: formatMoneySum(input.commissionSum),
    crossSell: deriveConversionMetric(
      input.crossSellTotal,
      input.crossSellConverted,
    ),
    upSell: deriveConversionMetric(input.upSellTotal, input.upSellConverted),
  };
}
