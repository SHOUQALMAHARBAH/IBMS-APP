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

/**
 * Part B §18/§28/§33 — the operations view.
 *
 * What a health check cannot answer: how many customers were actually
 * screened, how much of the queue nobody has picked up, which list generation
 * is live, and when the recurring work runs next.
 */
export interface ScreeningOverview {
  windowDays: number;
  since: string;
  attempts: {
    total: number;
    byOutcome: Record<string, number>;
    byProvider: Record<string, number>;
    unresolved: number;
    unresolvedRate: number;
    recentUnresolved: {
      correlationId: string;
      outcome: string;
      failureReason: string | null;
      providerName: string;
      startedAt: string;
      durationMs: number | null;
    }[];
  };
  matchQueue: {
    pending: number;
    pendingByAlgorithmVersion: Record<string, number>;
    currentAlgorithmVersion: string;
  };
  caseWorkload: Record<string, number>;
  datasets: {
    id: string;
    source: string;
    status: string;
    version: string;
    recordCount: number | null;
    addedCount: number | null;
    downloadedAt: string;
    publishedAt: string | null;
    rejectionReason: string | null;
    rollbackReason: string | null;
  }[];
  schedules: {
    rescreenBatch: { cron: string; nextRunAt: string | null };
    listSync: {
      cron: string;
      nextRunAt: string | null;
      lastSuccessAt: string | null;
    };
  };
  holds: {
    activeHolds: number;
    decidableFiles: number;
    releasedInWindow: number;
    policy: Record<string, string>;
    staleAfterDays: number;
    configurationProblems: string[];
  };
  listSync: {
    source: string;
    status: string;
    recordCount: number | null;
    addedCount: number | null;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  }[];
}

export function getScreeningOverview(
  windowDays = 30,
): Promise<ScreeningOverview> {
  return apiGet(`/screening/overview?windowDays=${windowDays}`);
}
