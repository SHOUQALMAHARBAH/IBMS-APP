// Process 53-54/Part 7.1 — the broker's own Professional Indemnity policy
// (backlog Part C #53-54's second checkbox). Reads/writes apps/api's
// /pi-policy endpoints — NOT a singleton (a renewal is a new row, "current"
// is the furthest-out expiresAt). pi-policy.manage (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export interface PiPolicy {
  id: string;
  insurerName: string;
  coverageLimit: string;
  expiresAt: string;
  claimsHistorySummary: string | null;
  isCurrentlyLapsed: boolean;
  isCurrent: boolean;
}

export function listPiPolicies(): Promise<PiPolicy[]> {
  return apiGet('/pi-policy');
}

export function getCurrentPiPolicy(): Promise<PiPolicy> {
  return apiGet('/pi-policy/current');
}

export function createPiPolicy(body: {
  insurerName: string;
  coverageLimit: string;
  expiresAt: string;
  claimsHistorySummary?: string;
}): Promise<PiPolicy> {
  return apiPost('/pi-policy', body);
}

export function recordPiClaimsHistory(
  id: string,
  claimsHistorySummary: string,
): Promise<PiPolicy> {
  return apiPost(`/pi-policy/${id}/claims-history`, { claimsHistorySummary });
}
