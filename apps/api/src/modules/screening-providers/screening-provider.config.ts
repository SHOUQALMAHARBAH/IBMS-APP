import type { ScreeningProviderKind } from './screening-provider.types';

/**
 * How a deployment chooses and configures its screening provider.
 *
 * ## Secrets
 *
 * An API key is read from the ENVIRONMENT and never returned by any endpoint,
 * never logged, and never stored in a source file. `describeConfig()` below
 * exists so the configuration screen can show what is set without ever
 * revealing it — a provider config UI that echoes back a key it just accepted
 * is a credential leak with a save button.
 */

/** Env var names, in one place so nothing greps for a string literal. */
export const SCREENING_ENV = {
  provider: 'SCREENING_PROVIDER',
  baseUrl: 'SCREENING_BASE_URL',
  apiKey: 'SCREENING_API_KEY',
  tenantId: 'SCREENING_TENANT_ID',
  dataset: 'SCREENING_DATASET',
  timeoutMs: 'SCREENING_TIMEOUT_MS',
  retries: 'SCREENING_MAX_RETRIES',
  sendIdentifiers: 'SCREENING_SEND_IDENTIFIERS',
  staleAfterHours: 'SCREENING_DATASET_STALE_AFTER_HOURS',
  thresholdHigh: 'SCREENING_MATCH_THRESHOLD_HIGH',
  thresholdReview: 'SCREENING_MATCH_THRESHOLD_REVIEW',
  thresholdLow: 'SCREENING_MATCH_THRESHOLD_LOW',
} as const;

/**
 * Match thresholds.
 *
 * DELIBERATELY CONFIGURABLE, and deliberately not defaulted to the "85%" the
 * uploaded requirements mention as a common figure. A threshold is a
 * risk-appetite decision with false-positive and false-negative costs the
 * broker owns; hard-coding one and treating it as a rule would be inventing a
 * regulatory requirement, which is the same failure the SLA work just
 * corrected. The defaults below are STARTING POINTS, recorded as such, and
 * every one of them is overridable per deployment.
 */
export interface MatchThresholds {
  /** At or above: strong enough that the case is opened at high risk. */
  high: number;
  /** At or above: opens a case for human review. Below `high`. */
  review: number;
  /** Below this, a candidate is discarded as noise rather than queued. Set to
   * 0 to queue everything the provider returns. */
  low: number;
}

export const DEFAULT_MATCH_THRESHOLDS: MatchThresholds = {
  high: 0.9,
  review: 0.7,
  low: 0.5,
};

export interface ScreeningProviderConfig {
  kind: ScreeningProviderKind;
  /** Present for on_premise / commercial. */
  baseUrl: string | null;
  /** NEVER surfaced. Presence is reported; the value is not. */
  apiKey: string | null;
  tenantId: string | null;
  /** Which dataset/collection to query, where the provider has more than one. */
  dataset: string | null;
  timeoutMs: number;
  maxRetries: number;
  /**
   * Whether national ID / passport may be sent to the provider.
   *
   * Defaults to FALSE. Sending a national ID to a third party is a
   * data-sharing decision with a PDPL basis behind it, not a matching
   * optimisation — so it is opt-in per deployment even though supplying more
   * attributes would reduce false positives.
   */
  sendIdentifiers: boolean;
  /** Beyond this, the provider's data is reported STALE and screening returns
   * UNABLE_TO_SCREEN rather than silently answering from old data. */
  datasetStaleAfterHours: number;
  thresholds: MatchThresholds;
}

/**
 * `min` matters: a retry count of ZERO is meaningful ("do not retry"), while a
 * timeout of zero is not. Treating every 0 as invalid silently turned an
 * explicit `SCREENING_MAX_RETRIES=0` into the default of 2 — a deployment
 * asking not to retry a provider got three attempts instead.
 */
function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true';
}

/**
 * Reads the provider configuration from the environment.
 *
 * Defaults to `built_in` rather than `NOT_CONFIGURED`: this deployment DOES
 * have a working provider — the synced OFAC/UN cache — and reporting it as
 * unconfigured would be as wrong in the other direction. `NOT_CONFIGURED` is
 * reserved for the case where a deployment ASKS for an external provider and
 * has not supplied what that provider needs.
 */
export function readScreeningConfig(
  env: NodeJS.ProcessEnv = process.env,
): ScreeningProviderConfig {
  const raw = (env[SCREENING_ENV.provider] ?? 'built_in').trim();
  const kind: ScreeningProviderKind =
    raw === 'on_premise' || raw === 'commercial' || raw === 'built_in'
      ? raw
      : 'built_in';

  return {
    kind,
    baseUrl: env[SCREENING_ENV.baseUrl]?.trim() || null,
    apiKey: env[SCREENING_ENV.apiKey]?.trim() || null,
    tenantId: env[SCREENING_ENV.tenantId]?.trim() || null,
    dataset: env[SCREENING_ENV.dataset]?.trim() || null,
    timeoutMs: envInt(SCREENING_ENV.timeoutMs, 10_000),
    maxRetries: envInt(SCREENING_ENV.retries, 2, 0),
    sendIdentifiers: envBool(SCREENING_ENV.sendIdentifiers, false),
    datasetStaleAfterHours: envInt(SCREENING_ENV.staleAfterHours, 48),
    thresholds: {
      high: envFloat(
        SCREENING_ENV.thresholdHigh,
        DEFAULT_MATCH_THRESHOLDS.high,
      ),
      review: envFloat(
        SCREENING_ENV.thresholdReview,
        DEFAULT_MATCH_THRESHOLDS.review,
      ),
      low: envFloat(SCREENING_ENV.thresholdLow, DEFAULT_MATCH_THRESHOLDS.low),
    },
  };
}

/** What a configured provider REQUIRES before it can be used at all. Returned
 * as a list so the health view and the config screen can say exactly what is
 * missing instead of "not configured". */
export function missingConfigFor(config: ScreeningProviderConfig): string[] {
  const missing: string[] = [];
  if (config.kind === 'on_premise') {
    if (!config.baseUrl) missing.push(SCREENING_ENV.baseUrl);
  }
  if (config.kind === 'commercial') {
    if (!config.baseUrl) missing.push(SCREENING_ENV.baseUrl);
    if (!config.apiKey) missing.push(SCREENING_ENV.apiKey);
  }
  return missing;
}

/** Thresholds must be ordered, or "high" and "review" stop meaning anything.
 * Returned rather than thrown so a bad value degrades to the defaults with a
 * loud log instead of refusing to screen at all. */
export function thresholdProblems(t: MatchThresholds): string[] {
  const problems: string[] = [];
  if (!(t.high >= t.review)) {
    problems.push(
      `${SCREENING_ENV.thresholdHigh} (${t.high}) must be >= ${SCREENING_ENV.thresholdReview} (${t.review})`,
    );
  }
  if (!(t.review >= t.low)) {
    problems.push(
      `${SCREENING_ENV.thresholdReview} (${t.review}) must be >= ${SCREENING_ENV.thresholdLow} (${t.low})`,
    );
  }
  return problems;
}

/**
 * A redacted view of the configuration, safe to return from an API and render
 * on a screen.
 *
 * The API key is reported as PRESENT or ABSENT and never echoed — not even
 * partially. A masked tail ("****3f9a") still leaks entropy and invites
 * shoulder-surfing, and there is no operator task that needs it.
 */
export function describeConfig(config: ScreeningProviderConfig): {
  provider: ScreeningProviderKind;
  baseUrl: string | null;
  apiKeyConfigured: boolean;
  tenantId: string | null;
  dataset: string | null;
  timeoutMs: number;
  maxRetries: number;
  sendIdentifiers: boolean;
  datasetStaleAfterHours: number;
  thresholds: MatchThresholds;
  missing: string[];
  thresholdProblems: string[];
} {
  return {
    provider: config.kind,
    baseUrl: config.baseUrl,
    apiKeyConfigured: config.apiKey !== null && config.apiKey.length > 0,
    tenantId: config.tenantId,
    dataset: config.dataset,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    sendIdentifiers: config.sendIdentifiers,
    datasetStaleAfterHours: config.datasetStaleAfterHours,
    thresholds: config.thresholds,
    missing: missingConfigFor(config),
    thresholdProblems: thresholdProblems(config.thresholds),
  };
}
