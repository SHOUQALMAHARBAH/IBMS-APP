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
  /** The provider's lifecycle state — richer than `status`: distinguishes
   * "never configured" from "configured and currently failing". */
  state:
    | "NOT_CONFIGURED"
    | "CONFIGURED"
    | "HEALTHY"
    | "DEGRADED"
    | "UNAVAILABLE"
    | "FAILED";
  /** Whether credentials were accepted. `null` when the provider needs none. */
  authenticationValid?: boolean | null;
  /**
   * What the provider can do, reported BY the provider.
   *
   * Three separate flags, because conflating them is how a system claims PEP
   * coverage it does not have:
   *   supported   — the adapter implements it
   *   configured  — this deployment supplied what it needs
   *   operational — it works right now
   */
  capabilities: {
    capability: string;
    supported: boolean;
    configured: boolean;
    operational: boolean;
    note: string;
  }[];
  /** Is PEP screening genuinely OPERATIONAL — not merely supported. */
  pepOperational: boolean;
  sanctionsOperational: boolean;
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
