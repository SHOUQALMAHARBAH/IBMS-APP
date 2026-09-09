// Part E — Executive Management Reporting (backlog Process #64), the sixth
// and last named dashboard. `dashboard.executive.view` had been in the seeded
// permission grid since the original RBAC build with no endpoint behind it.
//
// The payload is a ROLL-UP: a headline block plus the five underlying
// dashboards verbatim, so an executive figure can never disagree with the
// dashboard it summarises.

import { apiGet } from '../auth/api-client';

export interface ExecutiveHeadlines {
  newLeadsCount: number;
  leadConversionRatePercent: number;
  commissionIncomeJod: string;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  openClaimsCount: number;
  outstandingClaimsValueJod: string;
  receivablesOutstandingJod: string;
  payablesOutstandingJod: string;
  openDsrCount: number;
  openComplianceExceptionsCount: number;
}

/** The five section payloads are re-exported by their own dashboard clients;
 * this screen only reads the headline block plus a few pooled totals, so the
 * sections stay loosely typed here rather than duplicating five interfaces. */
export interface ExecutiveDashboardSummary {
  generatedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  headlines: ExecutiveHeadlines;
  sales: { premiumWritten: { newJod: string; renewalJod: string } };
  policy: { cancelledPolicies: { policyId: string; reason: string | null }[] };
  claims: { lossRatioByLine: { label: string; ratio: string }[] };
  financial: { receivables: { totals: { invoiceCount: number } } };
  compliance: { kyc: { byStatus: Record<string, number> } };
}

export interface ExecutiveDashboardQuery {
  branchId?: string;
  insuranceLine?: string;
  insurerId?: string;
  asOf?: string;
}

export function getExecutiveDashboard(
  opts: ExecutiveDashboardQuery = {},
): Promise<ExecutiveDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.asOf) params.set('asOf', opts.asOf);
  const qs = params.toString();
  return apiGet(`/dashboards/executive${qs ? `?${qs}` : ''}`);
}
