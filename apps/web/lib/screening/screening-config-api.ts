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
 * THE CAPABILITY LABELS — all NINE of them, the owner's words, and TOTAL with no `null` left.
 *
 * The `| null` is GONE and so is the screen's fall-through to the raw token: a `null` here was
 * the honest treatment while seven words were owed, and keeping one once they arrived would be a
 * fallback something can be added to. The same reasoning retired `AR_AGEING_BUCKET_FALLBACK`.
 *
 * `PEP`'s FORM IS HERS AND IS NOT THE ONE ON THIS SCREEN. The Arabic already here reads «فحص
 * الأشخاص السياسيين (PEP)» — genitive, inside a sentence — and hers is the nominative a column
 * label takes. Lifting the genitive run out of that sentence is morphology, which this repository
 * has refused once already by name (the «محاولتان» dual), and is the entire reason this was her
 * decision rather than a slice.
 *
 * `ADVERSE_MEDIA` WAS DECIDED TWICE: she rejected «الأخبار السلبية» as not clear enough to a
 * clerk and chose «التغطية الإعلامية السلبية», which is the AML term. The rejected one is the one
 * a later reader would guess.
 *
 * AND A TENTH MEMBER IS A COMPILE ERROR HERE ONLY IF SOMEBODY EDITS THIS UNION. My own comment
 * at this spot used to claim a capability added in the api alone would fail the build; it would
 * not — the value arrives over HTTP, so the lookup would return `undefined` and the row would
 * lose its label silently. `packages/db/prisma/capability-note-parity.spec.ts` is what makes it
 * fail, being the only place that can see both packages.
 */
export const PROVIDER_CAPABILITY_LABEL_KEY: Record<
  ProviderCapability,
  TranslationKey
> = {
  SANCTIONS: 'shCapSanctions',
  PEP: 'shCapPep',
  WATCHLIST: 'shCapWatchlist',
  ADVERSE_MEDIA: 'shCapAdverseMedia',
  INDIVIDUAL: 'shCapIndividual',
  ENTITY: 'shCapEntity',
  BATCH: 'shCapBatch',
  ONGOING_MONITORING: 'shCapOngoingMonitoring',
  WEBHOOKS: 'shCapWebhooks',
};

/**
 * WHICH SENTENCE SITS UNDER A CAPABILITY NAME — mirrored from the api's `CapabilityNoteKey`.
 *
 * Until this batch the api sent the sentence itself, in English, and this screen rendered it
 * verbatim: an Arabic compliance officer read an English token with an English sentence under it,
 * on the screen whose job is to say whether customers are actually being screened.
 * `hardcoded-ui-english.py` reported 0 and was right to — it reads this tree, and these strings
 * did not exist here. That is the structural class the thirteen risk-questionnaire prompts already
 * recorded by name, met for the SECOND time.
 */
export type CapabilityNoteKey =
  | 'BUILT_IN_SANCTIONS_SYNCED'
  | 'BUILT_IN_CACHE_EMPTY'
  | 'BUILT_IN_NO_PEP_DATA'
  | 'BUILT_IN_SANCTIONS_ONLY'
  | 'BUILT_IN_ADVERSE_MEDIA_UNAVAILABLE'
  | 'BUILT_IN_INDIVIDUAL_NAMES'
  | 'BUILT_IN_ENTITY_LEGAL_NAMES'
  | 'BUILT_IN_BATCH_LOCAL'
  | 'BUILT_IN_MONITORING_SCHEDULE'
  | 'BUILT_IN_WEBHOOKS_NOT_APPLICABLE'
  | 'COMMERCIAL_CONTRACT_COVERAGE'
  | 'COMMERCIAL_INDIVIDUAL'
  | 'COMMERCIAL_ENTITY'
  | 'COMMERCIAL_BATCH_FAN_OUT'
  | 'COMMERCIAL_MONITORING_ENROLMENT'
  | 'COMMERCIAL_WEBHOOKS_NOT_CONFIGURED'
  | 'ON_PREMISE_DATASET'
  | 'ON_PREMISE_PEP_VERIFY'
  | 'ON_PREMISE_PEP_SANCTIONS_ONLY'
  | 'ON_PREMISE_ADVERSE_MEDIA_UNAVAILABLE'
  | 'ON_PREMISE_PERSON_SCHEMA'
  | 'ON_PREMISE_ORGANIZATION_SCHEMA'
  | 'ON_PREMISE_BATCH_FAN_OUT'
  | 'ON_PREMISE_MONITORING_SCHEDULER'
  | 'ON_PREMISE_WEBHOOKS_UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'NOT_CONFIGURED_MISSING';

/**
 * WHAT THE NOTE IS, declared by the api and never derived here.
 *
 * Decision 58's shape: the api is the only layer that knows whether one of its own sentences
 * describes a capability or cautions against relying on it. Three of the five cautions are the
 * owner's own classification; two are declared in the api's `cautions()` doc comment as this
 * code's judgement, with the reason.
 */
export type CapabilityNoteKind = 'DESCRIPTION' | 'CAUTION';

export interface CapabilityNote {
  key: CapabilityNoteKey;
  params?: Record<string, string>;
  kind: CapabilityNoteKind;
}

/** TOTAL over the union. No `null`, no fall-through, and no English left on this path. */
export const CAPABILITY_NOTE_LABEL_KEY: Record<CapabilityNoteKey, TranslationKey> = {
  BUILT_IN_SANCTIONS_SYNCED: 'shNoteBuiltInSanctionsSynced',
  BUILT_IN_CACHE_EMPTY: 'shNoteBuiltInCacheEmpty',
  BUILT_IN_NO_PEP_DATA: 'shNoteBuiltInNoPepData',
  BUILT_IN_SANCTIONS_ONLY: 'shNoteBuiltInSanctionsOnly',
  BUILT_IN_ADVERSE_MEDIA_UNAVAILABLE: 'shNoteBuiltInAdverseMediaUnavailable',
  BUILT_IN_INDIVIDUAL_NAMES: 'shNoteBuiltInIndividualNames',
  BUILT_IN_ENTITY_LEGAL_NAMES: 'shNoteBuiltInEntityLegalNames',
  BUILT_IN_BATCH_LOCAL: 'shNoteBuiltInBatchLocal',
  BUILT_IN_MONITORING_SCHEDULE: 'shNoteBuiltInMonitoringSchedule',
  BUILT_IN_WEBHOOKS_NOT_APPLICABLE: 'shNoteBuiltInWebhooksNotApplicable',
  COMMERCIAL_CONTRACT_COVERAGE: 'shNoteCommercialContractCoverage',
  COMMERCIAL_INDIVIDUAL: 'shNoteCommercialIndividual',
  COMMERCIAL_ENTITY: 'shNoteCommercialEntity',
  COMMERCIAL_BATCH_FAN_OUT: 'shNoteCommercialBatchFanOut',
  COMMERCIAL_MONITORING_ENROLMENT: 'shNoteCommercialMonitoringEnrolment',
  COMMERCIAL_WEBHOOKS_NOT_CONFIGURED: 'shNoteCommercialWebhooksNotConfigured',
  ON_PREMISE_DATASET: 'shNoteOnPremiseDataset',
  ON_PREMISE_PEP_VERIFY: 'shNoteOnPremisePepVerify',
  ON_PREMISE_PEP_SANCTIONS_ONLY: 'shNoteOnPremisePepSanctionsOnly',
  ON_PREMISE_ADVERSE_MEDIA_UNAVAILABLE: 'shNoteOnPremiseAdverseMediaUnavailable',
  ON_PREMISE_PERSON_SCHEMA: 'shNoteOnPremisePersonSchema',
  ON_PREMISE_ORGANIZATION_SCHEMA: 'shNoteOnPremiseOrganizationSchema',
  ON_PREMISE_BATCH_FAN_OUT: 'shNoteOnPremiseBatchFanOut',
  ON_PREMISE_MONITORING_SCHEDULER: 'shNoteOnPremiseMonitoringScheduler',
  ON_PREMISE_WEBHOOKS_UNSUPPORTED: 'shNoteOnPremiseWebhooksUnsupported',
  NOT_CONFIGURED: 'shNoteNotConfigured',
  NOT_CONFIGURED_MISSING: 'shNoteNotConfiguredMissing',
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
    note: CapabilityNote;
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
