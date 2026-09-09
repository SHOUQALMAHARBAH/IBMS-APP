import type { ClaimsDashboardSummary } from './claims-dashboard.config';
import type { ComplianceDashboardSummary } from './compliance-dashboard.config';
import type { FinancialDashboardSummary } from './financial-dashboard.config';
import type { PolicyDashboardSummary } from './policy-dashboard.config';
import type { SalesDashboardSummary } from './sales-dashboard.config';

/**
 * Process 64 — Executive Management Reporting (backlog Part C #64 / Part E).
 *
 * The one dashboard permission that was seeded from the very first RBAC grid
 * and never wired to an endpoint (`dashboard.executive.view`). It is
 * deliberately a ROLL-UP, not a seventh independent set of queries: an
 * executive summary is by definition "the other dashboards, one level up",
 * and re-deriving the same figures from the same tables a second time is
 * precisely how two numbers that should agree stop agreeing (the same
 * two-sources-of-truth failure `IMPROVEMENTS.md` §3.1 records for
 * commission).
 */

/** The handful of figures an executive actually reads first, lifted out of
 * the five underlying summaries. Every value is already computed and
 * formatted by the dashboard it came from — nothing is recalculated here. */
export interface ExecutiveHeadlines {
  /** Sales — premium written in the period, and the commission it earned. */
  newLeadsCount: number;
  leadConversionRatePercent: number;
  commissionIncomeJod: string;
  /** Policy — the in-force book and what is about to fall out of it. */
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  /** Claims — the open exposure. */
  openClaimsCount: number;
  outstandingClaimsValueJod: string;
  /** Finance — what is owed to the broker and by the broker. */
  receivablesOutstandingJod: string;
  payablesOutstandingJod: string;
  /** Compliance — the count that should be zero. */
  openDsrCount: number;
  openComplianceExceptionsCount: number;
}

export interface ExecutiveDashboardSummary {
  generatedAt: string;
  /** Echoed so the reader can see which window and reference date produced
   * the figures without opening each section. */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  headlines: ExecutiveHeadlines;
  sales: SalesDashboardSummary;
  policy: PolicyDashboardSummary;
  claims: ClaimsDashboardSummary;
  financial: FinancialDashboardSummary;
  compliance: ComplianceDashboardSummary;
}

/**
 * Pure: lift the headline figures out of the five section summaries. Kept
 * separate from the service so the "which numbers matter" decision is
 * unit-testable without a database.
 */
export function buildExecutiveHeadlines(input: {
  sales: SalesDashboardSummary;
  policy: PolicyDashboardSummary;
  claims: ClaimsDashboardSummary;
  financial: FinancialDashboardSummary;
  compliance: ComplianceDashboardSummary;
}): ExecutiveHeadlines {
  const { sales, policy, claims, financial, compliance } = input;
  return {
    newLeadsCount: sales.leads.newLeadsCount,
    leadConversionRatePercent: sales.leads.conversionRatePercent,
    commissionIncomeJod: sales.commissionIncomeJod,
    activePoliciesCount: policy.activePoliciesCount,
    expiringPoliciesCount: policy.expiringPoliciesCount,
    openClaimsCount: claims.openClaimsCount,
    outstandingClaimsValueJod: claims.outstandingClaimsValueJod,
    receivablesOutstandingJod: financial.receivables.totals.outstandingTotal,
    payablesOutstandingJod: financial.payables.totals.outstandingAmount,
    openDsrCount: compliance.dsr.openCount,
    // "Exceptions" an executive is accountable for: an open AML alert and an
    // open breach are both live regulatory exposure, so they are pooled into
    // one number here and left broken out in the compliance section below.
    openComplianceExceptionsCount:
      compliance.complianceExceptions.openAmlAlertsCount +
      compliance.breachRegister.openCount,
  };
}

export function buildExecutiveDashboardSummary(input: {
  now: Date;
  sales: SalesDashboardSummary;
  policy: PolicyDashboardSummary;
  claims: ClaimsDashboardSummary;
  financial: FinancialDashboardSummary;
  compliance: ComplianceDashboardSummary;
}): ExecutiveDashboardSummary {
  const { now, sales, policy, claims, financial, compliance } = input;
  return {
    generatedAt: now.toISOString(),
    // The Sales and Policy dashboards resolve the same period window from the
    // same query, so either is authoritative; Sales is taken as the source.
    periodLabel: sales.periodLabel,
    periodStart: sales.periodStart,
    periodEnd: sales.periodEnd,
    asOf: financial.asOf,
    headlines: buildExecutiveHeadlines({
      sales,
      policy,
      claims,
      financial,
      compliance,
    }),
    sales,
    policy,
    claims,
    financial,
    compliance,
  };
}
