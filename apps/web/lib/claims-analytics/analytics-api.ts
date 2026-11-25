// Process 30 — Claims Analytics (backlog Part C #30, Domain C). Reads apps/api's
// GET /claims-analytics/loss-ratio: the aggregate Claims ÷ Premium breakdown
// (paid net settlements ÷ written premium, all-time) grouped by customer /
// policy / line, for the reporting dashboard. `claims-analytics.view`.

import { apiGet } from '../auth/api-client';

export const LOSS_RATIO_GROUP_BY = ['customer', 'policy', 'line'] as const;
export type LossRatioGroupBy = (typeof LOSS_RATIO_GROUP_BY)[number];

export interface LossRatioBreakdownRow {
  key: string;
  label: string;
  /** The same label in Arabic, or null — contents §أ row ١١. Populated for the insurer and line
   *  groupings only; `null` means render `label`, the English the record stored. */
  labelAr: string | null;
  periodClaims: string;
  periodPremium: string;
  ratio: string;
  ratioCapped: boolean;
  claimCount: number;
  policyCount: number;
}

export interface LossRatioBreakdown {
  groupBy: LossRatioGroupBy;
  rows: LossRatioBreakdownRow[];
  totals: Omit<LossRatioBreakdownRow, 'key' | 'label' | 'labelAr'>;
}

export interface LossRatioBreakdownFilters {
  groupBy: LossRatioGroupBy;
  customerId?: string;
  policyId?: string;
  insuranceLine?: string;
}

export function getLossRatioBreakdown(
  filters: LossRatioBreakdownFilters,
): Promise<LossRatioBreakdown> {
  const params = new URLSearchParams({ groupBy: filters.groupBy });
  if (filters.customerId) params.set('customerId', filters.customerId);
  if (filters.policyId) params.set('policyId', filters.policyId);
  if (filters.insuranceLine) params.set('insuranceLine', filters.insuranceLine);
  return apiGet(`/claims-analytics/loss-ratio?${params.toString()}`);
}
