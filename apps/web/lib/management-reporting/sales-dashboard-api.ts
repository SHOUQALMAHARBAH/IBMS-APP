// Part E — Sales Dashboard (backlog Process #64). dashboard.sales.view
// (already pre-seeded, shared with #59's own narrower /sales-performance
// endpoint) gates this read.

import { apiGet } from '../auth/api-client';

export interface SalesDashboardSummary {
  generatedAt: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  leads: {
    newLeadsCount: number;
    convertedToProspectCount: number;
    conversionRatePercent: number;
  };
  premiumWritten: { newJod: string; renewalJod: string; totalJod: string };
  commissionIncomeJod: string;
  crossSell: { totalCount: number; convertedCount: number; conversionRatePercent: number };
  upSell: { totalCount: number; convertedCount: number; conversionRatePercent: number };
}

export function getSalesDashboard(opts: {
  branchId?: string;
  insuranceLine?: string;
  insurerId?: string;
  periodLabel?: string;
  periodStart?: string;
  periodEnd?: string;
} = {}): Promise<SalesDashboardSummary> {
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
