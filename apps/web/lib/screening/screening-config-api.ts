import { apiGet } from "../auth/api-client";

// Screening provider configuration + data health (task §23, §32, §33).
//
// The API key is NEVER part of this shape. The server reports whether one is
// configured and nothing more — there is no field here that could leak it,
// which is the point.

export type ScreeningProviderKind = "built_in" | "on_premise" | "commercial";
export type ProviderHealthStatus =
  "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface ScreeningHealth {
  provider: ScreeningProviderKind;
  providerName: string;
  status: ProviderHealthStatus;
  detail: string;
  datasetVersion?: string | null;
  datasetUpdatedAt?: string | null;
  checkedAt: string;
  thresholds: { high: number; review: number; low: number };
  /** Settings the selected provider needs and does not have. */
  missing: string[];
  thresholdProblems: string[];
  sendIdentifiers: boolean;
  /** What this provider can actually answer. `pep: false` on the built-in
   * cache is a fact about coverage, not a bug. */
  coverage: { sanctions: boolean; pep: boolean; note: string };
}

export interface ScreeningConfig {
  provider: ScreeningProviderKind;
  baseUrl: string | null;
  /** Presence only. The key itself is never returned by the API. */
  apiKeyConfigured: boolean;
  tenantId: string | null;
  dataset: string | null;
  timeoutMs: number;
  maxRetries: number;
  sendIdentifiers: boolean;
  datasetStaleAfterHours: number;
  thresholds: { high: number; review: number; low: number };
  missing: string[];
  thresholdProblems: string[];
}

export function getScreeningHealth(): Promise<ScreeningHealth> {
  return apiGet("/screening/providers/health");
}

export function getScreeningConfig(): Promise<ScreeningConfig> {
  return apiGet("/screening/providers/config");
}
