// Process 59 — Sales Performance (backlog Part C #59, Domain G). Reads/
// writes apps/api's /sales-targets (sales-target.manage, Manager/
// Executive) and /sales-performance (dashboard.sales.view, already
// pre-seeded for Sales/Relationship Officer, Manager, Executive).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export interface SalesTarget {
  id: string;
  ownerUserId: string | null;
  branchId: string | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  targetNewProspects: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesPerformance {
  scope: { ownerUserId: string } | { branchId: string };
  target: SalesTarget | null;
  actual: { newLeads: number; newProspects: number } | null;
  achievementPercent: number | null;
}

export interface CreateSalesTargetInput {
  ownerUserId?: string;
  branchId?: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  targetNewProspects: number;
}

export function createSalesTarget(
  input: CreateSalesTargetInput,
): Promise<SalesTarget> {
  return apiPost('/sales-targets', input);
}

export function updateSalesTarget(
  id: string,
  targetNewProspects: number,
): Promise<SalesTarget> {
  return apiPatch(`/sales-targets/${id}`, { targetNewProspects });
}

export function listSalesTargets(filters: {
  ownerUserId?: string;
  branchId?: string;
}): Promise<SalesTarget[]> {
  const params = new URLSearchParams();
  if (filters.ownerUserId) params.set('ownerUserId', filters.ownerUserId);
  if (filters.branchId) params.set('branchId', filters.branchId);
  const qs = params.toString();
  return apiGet(`/sales-targets${qs ? `?${qs}` : ''}`);
}

export function getSalesPerformance(filters: {
  ownerUserId?: string;
  branchId?: string;
  periodLabel?: string;
}): Promise<SalesPerformance> {
  const params = new URLSearchParams();
  if (filters.ownerUserId) params.set('ownerUserId', filters.ownerUserId);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.periodLabel) params.set('periodLabel', filters.periodLabel);
  const qs = params.toString();
  return apiGet(`/sales-performance${qs ? `?${qs}` : ''}`);
}
