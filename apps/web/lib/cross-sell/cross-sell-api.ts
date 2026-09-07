// Process 8 — Cross-Selling (backlog Part C #8). Talks to apps/api's
// cross-sell module (cross-sell.controller.ts). A CrossSellOpportunity is
// only ever created by the gap scan (nightly, or the on-demand `detect`
// call here) — never by a user raising one — then converted or dismissed.

import { apiGet, apiPost } from '../auth/api-client';

export type CrossSellStatus = 'OPEN' | 'CONVERTED' | 'DISMISSED';

export interface CrossSellOpportunity {
  id: string;
  customerId: string;
  gapLine: string;
  status: CrossSellStatus;
  detectedAt: string;
  detectedByUserId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  dismissReason: string | null;
}

export interface CrossSellDetectionResult {
  customerId: string;
  heldLines: string[];
  gapLines: string[];
  benchmarkLines: string[];
  newlyFlagged: CrossSellOpportunity[];
  openOpportunities: CrossSellOpportunity[];
}

export function listCrossSellOpportunities(
  customerId: string,
  status?: CrossSellStatus,
): Promise<CrossSellOpportunity[]> {
  const q = new URLSearchParams({ customerId });
  if (status) q.set('status', status);
  return apiGet(`/cross-sell-opportunities?${q.toString()}`);
}

export function getCrossSellOpportunity(
  id: string,
): Promise<CrossSellOpportunity> {
  return apiGet(`/cross-sell-opportunities/${id}`);
}

export function detectCrossSell(
  customerId: string,
): Promise<CrossSellDetectionResult> {
  return apiPost('/cross-sell-opportunities/detect', { customerId });
}

export function convertCrossSellOpportunity(
  id: string,
): Promise<CrossSellOpportunity> {
  return apiPost(`/cross-sell-opportunities/${id}/convert`);
}

export function dismissCrossSellOpportunity(
  id: string,
  reason: string,
): Promise<CrossSellOpportunity> {
  return apiPost(`/cross-sell-opportunities/${id}/dismiss`, { reason });
}
