/**
 * The screening provider contract — the seam that lets a commercial PEP/
 * sanctions provider be connected later as an ADAPTER + CONFIGURATION change
 * rather than a rewrite of this compliance module.
 *
 * Everything below is deliberately provider-neutral. No type here mentions
 * OFAC, the UN, yente, or any vendor: the moment a business rule can only be
 * expressed in one provider's vocabulary, swapping providers becomes a
 * rewrite.
 */

/** Which implementation is in use. Selected by configuration, never by a
 * branch inside business logic. */
export type ScreeningProviderKind =
  /** The synced OFAC/UN cache this repo already maintains and matches
   * against. Real, free, no API key — and the default. */
  | 'built_in'
  /** A local screening engine over HTTP (yente / OpenSanctions), run in the
   * broker's own infrastructure so no customer data leaves it. */
  | 'on_premise'
  /** A commercial provider (Dow Jones / Refinitiv / ComplyAdvantage). */
  | 'commercial';

/**
 * What a screening attempt CONCLUDED. Distinct from "what was found", because
 * the difference between "we checked and found nothing" and "we could not
 * check" is the single most consequential distinction in this module.
 */
export type ScreeningAttemptOutcome =
  /** A populated source was searched and the subject was not on it. The ONLY
   * outcome that may be reported to a user as clear. */
  | 'NO_MATCH'
  /** One or more candidates require a human decision. Never a determination
   * on its own — a provider match is evidence, not a verdict. */
  | 'POTENTIAL_MATCH'
  /** No provider is configured for this deployment. The system must say so
   * rather than return NO_MATCH, which would be a claim it cannot support. */
  | 'NOT_CONFIGURED'
  /** A provider IS configured but the attempt failed — timeout, transport
   * error, auth rejection, malformed response. Explicitly NOT `NO_MATCH`. */
  | 'SCREENING_FAILED'
  /** The provider answered, but its data cannot support a decision: an empty
   * dataset, or one stale beyond the configured tolerance. */
  | 'UNABLE_TO_SCREEN';

/** Which list a candidate came from. PEP is first-class, not a flavour of
 * sanctions — the obligations attached to each are different. */
export type ScreeningListType = 'SANCTIONS' | 'PEP' | 'WATCHLIST';

/** What the subject and the candidate agreed on. Recorded because a name-only
 * agreement and a name+DOB+nationality agreement are very different evidence,
 * and a reviewer deciding a case needs to see which one they have. */
export type MatchedAttribute =
  | 'name'
  | 'alias'
  | 'dateOfBirth'
  | 'nationality'
  | 'nationalId'
  | 'passport'
  | 'country';

/** One thing the provider thinks might be the subject. */
export interface ProviderCandidate {
  /** The provider's own identifier for the entity. Stored so a reviewer can
   * look it up in the provider's console, and so re-screens can recognise the
   * same candidate. */
  providerEntityId: string;
  entityName: string;
  entityType: 'individual' | 'organization' | 'unknown';
  listType: ScreeningListType;
  /** 0..1. Provider-native where the provider supplies one; computed by the
   * adapter otherwise. Compared against CONFIGURABLE thresholds — never a
   * hard-coded 0.85, which would be an invented regulatory rule. */
  score: number;
  matchedAttributes: MatchedAttribute[];
  /** Which list/programme, e.g. "OFAC_SDN (SDGT)" or "EU Financial Sanctions". */
  sourceList: string;
  /** Provider-supplied context. Free text and potentially personal data —
   * subject to the same handling as any other Highly Confidential field. */
  remarks?: string | null;
  /** For a PEP candidate: the position that makes them politically exposed.
   * Null for a sanctions candidate. */
  pepPosition?: string | null;
}

/** The subject being screened. Multi-attribute by design: the uploaded
 * requirements note that name-only matching manufactures false positives, so
 * every attribute a provider can use is offered to it. */
export interface ScreeningSubject {
  /** Stable id for correlation/idempotency — NOT sent to a provider. */
  subjectRef: string;
  fullName: string;
  aliases?: string[];
  entityType: 'individual' | 'organization';
  dateOfBirth?: string | null;
  nationality?: string | null;
  country?: string | null;
  /** Highly Confidential. Only sent to a provider that is configured to
   * receive it — see `ScreeningProviderConfig.sendIdentifiers`. */
  nationalId?: string | null;
  passportNumber?: string | null;
}

/** What one screening attempt produced. */
export interface ProviderScreeningResult {
  outcome: ScreeningAttemptOutcome;
  candidates: ProviderCandidate[];
  /** Which provider answered, for the audit trail and for a reviewer reading
   * a case months later. */
  provider: ScreeningProviderKind;
  providerName: string;
  /** The dataset the answer was computed against. A decision is only
   * reproducible if you know what data produced it. */
  datasetVersion?: string | null;
  /** Echoed into logs and audit rows so one screening can be traced across
   * the app, the provider and the queue. */
  correlationId: string;
  /** Present only for SCREENING_FAILED / NOT_CONFIGURED / UNABLE_TO_SCREEN.
   * Never contains credentials or subject PII. */
  failureReason?: string;
  /** Wall-clock cost of the attempt, for the health view. */
  durationMs: number;
}

/**
 * What a provider can do (task §26).
 *
 * Three separate questions, because conflating them is how a system ends up
 * claiming PEP coverage it does not have:
 *
 *   supported   — this ADAPTER implements the capability at all
 *   configured  — this DEPLOYMENT has supplied what the capability needs
 *   operational — it is working RIGHT NOW, per the last health check
 *
 * `PEP: supported=true, configured=false` is an honest and common state. It
 * must never render as "PEP screening is available".
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

export interface CapabilityState {
  capability: ProviderCapability;
  supported: boolean;
  configured: boolean;
  operational: boolean;
  /** Why, in terms an operator can act on. */
  note: string;
}

/**
 * The provider's own lifecycle state (task §4), distinct from the outcome of
 * any one screening.
 *
 * `CONFIGURED` is deliberately separate from `HEALTHY`: a provider can be
 * fully configured and still unreachable, and treating configuration presence
 * as health is exactly the check that lets a dead provider look fine.
 */
export type ProviderState =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'FAILED';

export type ProviderHealthStatus =
  'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export interface ProviderHealth {
  provider: ScreeningProviderKind;
  providerName: string;
  status: ProviderHealthStatus;
  /** The lifecycle state (§4). Richer than `status`: distinguishes "never
   * configured" from "configured and currently failing". */
  state: ProviderState;
  /** Human-readable, safe to display. Never credentials. */
  detail: string;
  datasetVersion?: string | null;
  /** When the provider's data was last refreshed, where it exposes that. */
  datasetUpdatedAt?: string | null;
  checkedAt: string;
  /** What this provider can actually do (§26/§27). */
  capabilities: CapabilityState[];
  /** Whether credentials were accepted, where the provider authenticates.
   * `null` when the provider needs none (the built-in cache). */
  authenticationValid?: boolean | null;
}

/**
 * What every provider implements.
 *
 * Kept small on purpose. A fat interface would push provider-specific
 * concepts into callers and defeat the point of having a seam at all.
 */
export interface ScreeningProvider {
  readonly kind: ScreeningProviderKind;
  readonly name: string;

  screenIndividual(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult>;

  screenOrganization(
    subject: ScreeningSubject,
    correlationId: string,
  ): Promise<ProviderScreeningResult>;

  /** Batch screening. A provider with a native batch endpoint should override
   * this; the default in `BaseScreeningProvider` fans out sequentially, which
   * is correct if slower. */
  screenBatch(
    subjects: readonly ScreeningSubject[],
    correlationId: string,
  ): Promise<ProviderScreeningResult[]>;

  getProviderHealth(): Promise<ProviderHealth>;

  /** What this provider can do. Static in `supported`, deployment-dependent
   * in `configured`, health-dependent in `operational`. */
  capabilities(): CapabilityState[];
}

/** Convenience for building a capability row. */
export function capability(
  cap: ProviderCapability,
  supported: boolean,
  configured: boolean,
  operational: boolean,
  note: string,
): CapabilityState {
  return { capability: cap, supported, configured, operational, note };
}

/** Outcomes that mean "this subject was NOT cleared, and not because they
 * matched something". Grouped because every one of them must escalate rather
 * than pass, and callers should not re-derive that list. */
export const UNRESOLVED_OUTCOMES: readonly ScreeningAttemptOutcome[] = [
  'NOT_CONFIGURED',
  'SCREENING_FAILED',
  'UNABLE_TO_SCREEN',
];

export function isUnresolved(outcome: ScreeningAttemptOutcome): boolean {
  return UNRESOLVED_OUTCOMES.includes(outcome);
}

/** True only for the one outcome that may be presented as "clear". */
export function isClear(outcome: ScreeningAttemptOutcome): boolean {
  return outcome === 'NO_MATCH';
}
