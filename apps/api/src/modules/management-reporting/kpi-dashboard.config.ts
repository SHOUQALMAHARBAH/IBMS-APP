import type { StatusCountRow } from '../../repositories/kpi-dashboard.repository';
import {
  formatMoney,
  sumMoney,
  type MoneyInput,
} from '../../common/money.util';

/**
 * Process 58 (backlog Part C #58, Domain G — opens Domain G) — "General KPI
 * dashboard: aggregate queries across every module above." The backlog line
 * names no model and no specific metric list — deliberately scoped here to
 * a curated, low-risk set: a plain count or `groupBy` count per domain
 * already built (Sales/CRM, Policy, Claims, Customer Service, Compliance &
 * Risk), plus three unambiguous money sums for Finance (outstanding
 * invoiced, total issued premium, commission this month) that need no
 * netting/commission-deduction logic to compute correctly — see
 * `ibms-brain/meta/context/kpi-dashboard.md` for why a handful of
 * department-specific dashboards (`#59`–`#64`, already pre-seeded as
 * `dashboard.sales.view` etc.) were deliberately NOT reimplemented here,
 * and why this reads every table directly rather than composing the
 * existing `FinancialReportService`/`SlaDashboardService`/
 * `ClaimsAnalyticsService` summaries.
 */

export interface KpiDashboardSummary {
  generatedAt: string;
  sales: {
    totalCustomers: number;
    leadsByStatus: Record<string, number>;
    prospectsByStatus: Record<string, number>;
    opportunitiesByStatus: Record<string, number>;
  };
  policy: {
    policiesByStatus: Record<string, number>;
    totalIssuedPremiumJod: string;
  };
  claims: {
    claimsByStatus: Record<string, number>;
  };
  finance: {
    outstandingInvoicedJod: string;
    invoicesByStatus: Record<string, number>;
    commissionThisMonthJod: string;
  };
  customerService: {
    complaintsByStatus: Record<string, number>;
    openServiceRequests: number;
  };
  complianceRisk: {
    openRiskRegisterItems: number;
    openIncidents: number;
    openInternalAuditFindings: number;
  };
}

/** Pure: `groupBy` rows -> a plain status-to-count map, every known status
 * present (even at zero) is NOT guaranteed — only statuses with at least
 * one row appear, the same "sparse map" shape `groupBy` itself returns. */
export function buildStatusCountMap(
  rows: StatusCountRow[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.status] = row.count;
  }
  return map;
}

/** Pure: midnight UTC on the 1st of the month containing `now`. */
export function startOfCurrentUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Pure: formats a possibly-null Prisma aggregate sum as a fixed 3dp JOD
 * string — `null` (no matching rows) renders as `"0.000"`, not a crash. */
export function formatMoneySum(value: MoneyInput | null): string {
  return value === null ? formatMoney(0) : formatMoney(sumMoney([value]));
}
