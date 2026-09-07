// Process 60 — Insurer Performance (backlog Part C #60, Domain G). Reads/
// writes apps/api's /insurer-performance (insurer-performance.view,
// already pre-seeded for Branch/Department Manager, Executive Management —
// no new permission was needed for this process).

import { apiGet, apiPost } from '../auth/api-client';

export interface InsurerPerformanceScore {
  id: string;
  insurerId: string;
  periodLabel: string;
  quoteResponseScore: string;
  claimsServiceScore: string;
  priceScore: string;
  serviceQualityScore: string;
  computedAt: string;
}

export interface ComputeInsurerPerformanceInput {
  insurerId: string;
  periodLabel?: string;
  periodStart?: string;
  periodEnd?: string;
}

export function computeInsurerPerformance(
  input: ComputeInsurerPerformanceInput,
): Promise<InsurerPerformanceScore> {
  return apiPost('/insurer-performance/compute', input);
}

export function listInsurerPerformance(filters: {
  insurerId?: string;
  periodLabel?: string;
}): Promise<InsurerPerformanceScore[]> {
  const params = new URLSearchParams();
  if (filters.insurerId) params.set('insurerId', filters.insurerId);
  if (filters.periodLabel) params.set('periodLabel', filters.periodLabel);
  const qs = params.toString();
  return apiGet(`/insurer-performance${qs ? `?${qs}` : ''}`);
}

export function getLatestInsurerPerformance(
  insurerId: string,
): Promise<InsurerPerformanceScore> {
  return apiGet(`/insurer-performance/${insurerId}/latest`);
}
