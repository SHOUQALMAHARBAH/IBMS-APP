// Part E — Policy Dashboard (backlog Process #64). dashboard.policy.view
// (already pre-seeded) gates this read.

import { apiGet } from '../auth/api-client';

export interface CancelledPolicyRow {
  policyId: string;
  policyNumber: string | null;
  insuranceLine: string;
  reason: string;
  cancelledAt: string;
}

export interface PolicyDashboardSummary {
  generatedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  renewalWindowDays: number;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  newPoliciesIssuedCount: number;
  cancelledPolicies: CancelledPolicyRow[];
}

export function getPolicyDashboard(opts: {
  branchId?: string;
  insuranceLine?: string;
  insurerId?: string;
  periodLabel?: string;
  periodStart?: string;
  periodEnd?: string;
  renewalWindowDays?: number;
} = {}): Promise<PolicyDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.periodLabel) params.set('periodLabel', opts.periodLabel);
  if (opts.periodStart) params.set('periodStart', opts.periodStart);
  if (opts.periodEnd) params.set('periodEnd', opts.periodEnd);
  if (opts.renewalWindowDays) params.set('renewalWindowDays', String(opts.renewalWindowDays));
  const qs = params.toString();
  return apiGet(`/dashboards/policy${qs ? `?${qs}` : ''}`);
}
