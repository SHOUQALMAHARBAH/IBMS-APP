// Part E — Policy Dashboard (backlog Process #64). dashboard.policy.view
// (already pre-seeded) gates this read.

import { apiGet } from '../auth/api-client';

// ONE definition of the scope vocabulary on this side, imported rather than repeated:
// two copies would be two answers to *does this figure obey the period*.
import type { FigureScope } from './sales-dashboard-api';

export interface CancelledPolicyRow {
  policyId: string;
  policyNumber: string | null;
  /** Owner decision 50 — the customer's own name, for a policy with no number yet. */
  customerName: string;
  insuranceLine: string;
  reason: string;
  cancelledAt: string;
}

export interface PolicyDashboardSummary {
  generatedAt: string;
  /** Owner decision 58. TWO of these four are `'asOf'` — the active and expiring
   *  counts read `Policy.status`/`Policy.expiryDate` as of now whatever period is
   *  chosen, which `policy-dashboard.config.ts` calls a deliberate asymmetry. */
  metricScope: {
    activePoliciesCount: FigureScope;
    expiringPoliciesCount: FigureScope;
    newPoliciesIssuedCount: FigureScope;
    cancelledPolicies: FigureScope;
  };
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  renewalWindowDays: number;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  newPoliciesIssuedCount: number;
  cancelledPolicies: CancelledPolicyRow[];
}

export function getPolicyDashboard(
  opts: {
    branchId?: string;
    insuranceLine?: string;
    insurerId?: string;
    periodLabel?: string;
    periodStart?: string;
    periodEnd?: string;
    renewalWindowDays?: number;
  } = {},
): Promise<PolicyDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.periodLabel) params.set('periodLabel', opts.periodLabel);
  if (opts.periodStart) params.set('periodStart', opts.periodStart);
  if (opts.periodEnd) params.set('periodEnd', opts.periodEnd);
  if (opts.renewalWindowDays)
    params.set('renewalWindowDays', String(opts.renewalWindowDays));
  const qs = params.toString();
  return apiGet(`/dashboards/policy${qs ? `?${qs}` : ''}`);
}
