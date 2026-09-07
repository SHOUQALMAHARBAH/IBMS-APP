// Process 9 — Up-Selling (backlog Part C #9). Talks to apps/api's up-sell
// module (up-sell.controller.ts). An UpSellRecommendation is only ever
// created by the under-insurance scan (nightly, or the on-demand `detect`
// call here) — never by a user raising one — then converted or dismissed.
// Money figures are fils-precision decimal strings, never JS numbers
// (ibms-brain/meta/lex/money-decimal-jod.md).

import { apiGet, apiPost } from '../auth/api-client';

export type UpSellStatus = 'OPEN' | 'CONVERTED' | 'DISMISSED';

export interface UpSellRecommendation {
  id: string;
  customerId: string;
  currentSumInsured: string;
  currentAssetValue: string;
  status: UpSellStatus;
  detectedAt: string;
  detectedByUserId: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  dismissReason: string | null;
}

export interface UpSellDetectionResult {
  customerId: string;
  currentSumInsured: string;
  currentAssetValue: string;
  shortfall: string;
  thresholdAmount: string;
  thresholdPercent: string;
  programLineCount: number;
  assetCount: number;
  isUnderinsured: boolean;
  suppressedByPriorResolution: boolean;
  flagged: UpSellRecommendation | null;
  openRecommendation: UpSellRecommendation | null;
}

export function listUpSellRecommendations(
  customerId: string,
  status?: UpSellStatus,
): Promise<UpSellRecommendation[]> {
  const q = new URLSearchParams({ customerId });
  if (status) q.set('status', status);
  return apiGet(`/up-sell-recommendations?${q.toString()}`);
}

export function getUpSellRecommendation(
  id: string,
): Promise<UpSellRecommendation> {
  return apiGet(`/up-sell-recommendations/${id}`);
}

export function detectUpSell(
  customerId: string,
): Promise<UpSellDetectionResult> {
  return apiPost('/up-sell-recommendations/detect', { customerId });
}

export function convertUpSellRecommendation(
  id: string,
): Promise<UpSellRecommendation> {
  return apiPost(`/up-sell-recommendations/${id}/convert`);
}

export function dismissUpSellRecommendation(
  id: string,
  reason: string,
): Promise<UpSellRecommendation> {
  return apiPost(`/up-sell-recommendations/${id}/dismiss`, { reason });
}
