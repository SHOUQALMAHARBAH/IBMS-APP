import { addMoney, formatMoney, formatMoneySum } from '../../common/money.util';
import type { MoneyInput } from '../../common/money.util';
import type { PeriodWindow } from '../../common/period.util';

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
  conversionRatePercent: number;
}

export interface PremiumWrittenMetric {
  newJod: string;
  renewalJod: string;
  totalJod: string;
}

export interface ConversionMetric {
  totalCount: number;
  convertedCount: number;
  conversionRatePercent: number;
}

export interface SalesDashboardSummary {
  generatedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  leads: LeadsMetric;
  premiumWritten: PremiumWrittenMetric;
  commissionIncomeJod: string;
  crossSell: ConversionMetric;
  upSell: ConversionMetric;
}

/** Pure: a percentage rounded to 2dp; 0 (not NaN) when there is nothing to
 * convert from — an empty cohort has a 0% conversion rate, not undefined. */
export function computeConversionRatePercent(
  convertedCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) return 0;
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
