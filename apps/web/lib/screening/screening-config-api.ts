import type { TranslationKey } from '../i18n/translations';
import { apiGet } from "../auth/api-client";

// Screening provider configuration + data health (task §23, §32, §33).
//
// The API key is NEVER part of this shape. The server reports whether one is
// configured and nothing more — there is no field here that could leak it,
// which is the point.

export type WatchlistSource = 'OFAC_SDN' | 'UN_CONSOLIDATED';

export type ScreeningProviderKind = "built_in" | "on_premise" | "commercial";
export type ScreeningAttemptOutcome =
  | 'NO_MATCH'
  | 'POTENTIAL_MATCH'
  | 'NOT_CONFIGURED'
  | 'SCREENING_FAILED'
  | 'UNABLE_TO_SCREEN';

/**
 * WHAT A SCREENING PROVIDER CAN DO — nine capabilities, mirrored from the api's own
 * `ProviderCapability`. Declared here rather than typed `string`, because the capability table on
 * `/screening-health` labels each row and a `Record<string, …>` lookup that falls through renders
 * the raw token, which is the defect owner answer 2 exists to close.
 *
 * EVERY PROVIDER REPORTS ALL NINE. The built-in, on-premise and commercial adapters each build
 * nine rows and `not-configured` maps over a nine-element list, so this table is always nine rows
 * long whatever is configured.
 */
export type ProviderCapability =
  | 'SANCTIONS'
  | 'PEP'
  | 'WATCHLIST'
  | 'ADVERSE_MEDIA'
  | 'INDIVIDUAL'
  | 'ENTITY'
  | 'BATCH'
  | 'ONGOING_MONITORING'
  | 'WEBHOOKS';

/**
 * THE CAPABILITY LABELS — owner answer 2, and it is TOTAL over the union by her own instruction:
 * *"A third capability added to the api should be a COMPILE ERROR in the web."* A tenth member
 * therefore cannot be added without deciding its word, and nothing falls through to the token by
 * accident.
 *
 * TWO OF THE NINE HAVE A WORD AND SEVEN DO NOT. She gave `SANCTIONS` and `PEP` — the two her
 * capture showed, because the capture's own fixture carried two rows where the product renders
 * nine. The other seven render their member name, which is visibly unfinished: the established
 * treatment here (decision 41, `WORKFLOW_ENTITY_LABEL`) is that an English token in an Arabic
 * table is obviously owed, where a plausible invented word is indistinguishable from a decided one
 * and never gets corrected. The seven are in `docs/design-pass-register.md`.
 *
 * `PEP`'s FORM IS HERS AND IS NOT THE ONE ON THIS SCREEN. The Arabic already here reads «فحص
 * الأشخاص السياسيين (PEP)» — genitive, inside a sentence — and hers is the nominative a column
 * label takes. Lifting the genitive run out of that sentence is morphology, which this repository
 * has refused once already by name (the «محاولتان» dual), and is the entire reason this was her
 * decision rather than a slice.
 */
export const PROVIDER_CAPABILITY_LABEL_KEY: Record<
  ProviderCapability,
  TranslationKey | null
> = {
  SANCTIONS: 'shCapSanctions',
  PEP: 'shCapPep',
  WATCHLIST: null,
  ADVERSE_MEDIA: null,
  INDIVIDUAL: null,
  ENTITY: null,
  BATCH: null,
  ONGOING_MONITORING: null,
  WEBHOOKS: null,
};

export type DatasetVersionStatus =
  | 'DOWNLOADED'
  | 'VALIDATED'
  | 'PUBLISHED'
  | 'SUPERSEDED'
  | 'REJECTED';

export type WatchlistSyncRunStatus = 'running' | 'succeeded' | 'failed';

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
    capability: ProviderCapability;
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
    /*
     * KEYED ON THE ENUM, NOT ON `string`. This was `Record<string, number>`, and that is what
     * made `/screening-health` render `NO_MATCH` raw beside a complete bilingual label map it
     * never reached — `ENUM_LABEL.ScreeningAttemptOutcome` has shipped all five members in both
     * languages the whole time. `Partial` because the api sends only the outcomes that actually
     * occurred in the window, so an absent key means zero attempts of that kind rather than an
     * unknown outcome; a SIXTH member added to the enum is a compile error in the label map.
     */
    byOutcome: Partial<Record<ScreeningAttemptOutcome, number>>;
    byProvider: Record<string, number>;
    unresolved: number;
    unresolvedRate: number;
    recentUnresolved: {
      correlationId: string;
      outcome: ScreeningAttemptOutcome;
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
    source: WatchlistSource;
    status: DatasetVersionStatus;
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
    source: WatchlistSource;
    status: WatchlistSyncRunStatus;
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
