// Part E — Compliance Dashboard (backlog Process #64). dashboard.compliance.view
// (already pre-seeded) gates this read. No `insuranceLine`/`insurerId`/`asOf`
// query params — none of the seven underlying registers ties to a Policy, and
// every section is pure current-state.

import { apiGet } from '../auth/api-client';

export interface ComplianceDashboardSummary {
  generatedAt: string;
  kyc: { byStatus: Record<string, number> };
  complaints: { byStatus: Record<string, number>; byCategory: Record<string, number> };
  complianceExceptions: {
    openAmlAlertsCount: number;
    amlByPatternType: Record<string, number>;
    lastSelfApprovalScan: { asOf: string; violationCount: number } | null;
  };
  regulatoryFilings: {
    totalCount: number;
    submittedCount: number;
    overdueCount: number;
    pendingCount: number;
  };
  dsr: { openCount: number; byStatus: Record<string, number> };
  breachRegister: { openCount: number; byStatus: Record<string, number> };
  dpiaBacklog: { pendingReviewCount: number; byOutcome: Record<string, number> };
}

export function getComplianceDashboard(opts: { branchId?: string } = {}): Promise<ComplianceDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  const qs = params.toString();
  return apiGet(`/dashboards/compliance${qs ? `?${qs}` : ''}`);
}
