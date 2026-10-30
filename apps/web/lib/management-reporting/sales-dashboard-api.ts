// Part E — Sales Dashboard (backlog Process #64). dashboard.sales.view
// (already pre-seeded, shared with #59's own narrower /sales-performance
// endpoint) gates this read.

import { apiGet } from '../auth/api-client';

/**
 * OWNER DECISION 58 — which figures the period above actually describes.
 *
 * `'period'` counts events inside the window, so the period belongs beside the
 * figure. `'asOf'` is a LIVE SNAPSHOT that ignores the window — printing a period
 * beside one of those would be a false statement about a figure that does not obey
 * it, which is a more confident version of the defect decision 58 removes.
 *
 * READ FROM THE WIRE, never decided here: the api is the only thing that knows
 * which of its own queries apply the filter, and a copy of that classification on
 * this side is a copy free to stop matching.
 */
export type FigureScope = 'period' | 'asOf';

export interface SalesDashboardSummary {
  generatedAt: string;
  metricScope: {
    leads: FigureScope;
    premiumWritten: FigureScope;
    commissionIncomeJod: FigureScope;
    crossSell: FigureScope;
    upSell: FigureScope;
  };
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  leads: {
    newLeadsCount: number;
    convertedToProspectCount: number;
    /** NULL when the cohort is empty — no rate, not a rate of zero. Render as an em dash. */
    conversionRatePercent: number | null;
  };
  premiumWritten: { newJod: string; renewalJod: string; totalJod: string };
  commissionIncomeJod: string;
  crossSell: {
    totalCount: number;
    convertedCount: number;
    conversionRatePercent: number | null;
  };
  upSell: {
    totalCount: number;
    convertedCount: number;
    conversionRatePercent: number | null;
  };
}

export function getSalesDashboard(
  opts: {
    branchId?: string;
    insuranceLine?: string;
    insurerId?: string;
    periodLabel?: string;
    periodStart?: string;
    periodEnd?: string;
  } = {},
): Promise<SalesDashboardSummary> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set('branchId', opts.branchId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.periodLabel) params.set('periodLabel', opts.periodLabel);
  if (opts.periodStart) params.set('periodStart', opts.periodStart);
  if (opts.periodEnd) params.set('periodEnd', opts.periodEnd);
  const qs = params.toString();
  return apiGet(`/dashboards/sales${qs ? `?${qs}` : ''}`);
}
