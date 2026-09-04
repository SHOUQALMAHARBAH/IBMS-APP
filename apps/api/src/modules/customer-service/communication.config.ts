import type { InteractionChannel, LanguagePreference, Prisma } from '@ibms/db';

/**
 * Process 44 — Customer Communication (backlog Part C #44, Domain E). The
 * pure, deterministic core: the channel domain, marketing-consent evaluation,
 * channel / language resolution, and the view / audit-snapshot shapes.
 *
 * `CommunicationLog` is NOT a `WorkflowTransitionService` entity and has no
 * maker/checker — it is a factual send log (like `Interaction` #10 and the
 * Process-12 RFQ-correspondence rows on the same table). A Process-44 row is
 * the subset with `rfqId IS NULL`.
 *
 * `ibms-brain/meta/context/customer-service-lifecycle.md` § "Customer
 * Communication (Process 44)".
 */

/** Channels a customer communication can go out on — the outbound-relevant
 * subset of `InteractionChannel` (a meeting / visit / claim / complaint is an
 * interaction *context*, not a send channel). */
export const COMMUNICATION_CHANNELS = [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'CALL',
  'PORTAL',
  'OTHER',
] as const satisfies readonly InteractionChannel[];
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export function isCommunicationChannel(v: string): v is CommunicationChannel {
  return (COMMUNICATION_CHANNELS as readonly string[]).includes(v);
}

/** Cap on a book-wide Process-44 `CommunicationLog` list. */
export const COMMUNICATION_READ_LIMIT = 5000;

/** `body` / `subject` are Confidential-tier free text — returned unmasked and
 * kept out of the audit row, but a full bank/card number belongs on an
 * approved `PaymentChannel` (Process 38), not in a message body. Shared guard,
 * `common/dto.util.ts` (same use as Process 41 / 42). */
export {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../common/dto.util';

// --- marketing-consent evaluation ------------------------------------------

export interface MarketingConsentRow {
  id: string;
  granted: boolean;
  withdrawnAt: Date | null;
  grantedAt: Date | null;
  createdAt: Date;
}

export type MarketingConsentReason =
  'granted' | 'no_record' | 'not_granted' | 'withdrawn';

export interface MarketingConsentDecision {
  allowed: boolean;
  reason: MarketingConsentReason;
  consentRecordId: string | null;
}

/**
 * Whether a marketing communication may be sent, given the customer's
 * MARKETING consent records (the repository has already filtered to
 * `purpose = MARKETING OR isMarketing = true`). Pure — no DB, no `now()`.
 *
 * **Rule (fail-safe):** a send is allowed only if there is an *active grant*
 * (`granted === true && withdrawnAt === null`) and **no withdrawal event is at
 * least as recent as the newest active grant**. So a re-opt-in after an
 * earlier withdrawal is honoured (the new grant is more recent), but a
 * withdrawal recorded after — or at the same instant as — the newest active
 * grant blocks, even when it sits on a different (older) record. "Effective
 * time" is `grantedAt ?? createdAt` for a grant and `withdrawnAt` for a
 * withdrawal.
 *
 * PDPL / `PRIV-SOP-04` (M03): marketing consent is a distinct, opt-in
 * control; its absence — and any ambiguity about whether it still stands — is
 * a "no", never a "maybe", so the multi-record tiebreak leans blocked. The
 * exact precedence is drafted pending a pinned `PRIV-SOP-04` section (like the
 * drafted SLA figures elsewhere); single grant / withdraw on one record — the
 * common case — is unambiguous.
 */
export function evaluateMarketingConsent(
  records: readonly MarketingConsentRow[],
): MarketingConsentDecision {
  if (records.length === 0) {
    return { allowed: false, reason: 'no_record', consentRecordId: null };
  }

  const grantTime = (r: MarketingConsentRow): number =>
    (r.grantedAt ?? r.createdAt).getTime();

  const activeGrants = records
    .filter((r) => r.granted && r.withdrawnAt === null)
    .sort((a, b) => grantTime(b) - grantTime(a) || compareRaw(b.id, a.id));
  const latestActiveGrant = activeGrants[0] ?? null;

  const withdrawals = records
    .filter(
      (r): r is MarketingConsentRow & { withdrawnAt: Date } =>
        r.withdrawnAt !== null,
    )
    .sort(
      (a, b) =>
        b.withdrawnAt.getTime() - a.withdrawnAt.getTime() ||
        compareRaw(b.id, a.id),
    );
  const latestWithdrawal = withdrawals[0] ?? null;

  if (
    latestActiveGrant !== null &&
    (latestWithdrawal === null ||
      latestWithdrawal.withdrawnAt.getTime() < grantTime(latestActiveGrant))
  ) {
    return {
      allowed: true,
      reason: 'granted',
      consentRecordId: latestActiveGrant.id,
    };
  }

  if (latestWithdrawal !== null) {
    return {
      allowed: false,
      reason: 'withdrawn',
      consentRecordId: latestWithdrawal.id,
    };
  }

  // No active grant and nothing withdrawn ⇒ every record is `granted: false`.
  const newest = [...records].sort(
    (a, b) => grantTime(b) - grantTime(a) || compareRaw(b.id, a.id),
  )[0];
  return { allowed: false, reason: 'not_granted', consentRecordId: newest.id };
}

/** Byte-stable string compare for a deterministic tiebreak (no locale — the
 * #43 `compareRaw` precedent; a UUID tiebreak must not shift under a non-`en`
 * ICU collation). */
function compareRaw(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- channel / language resolution ---------------------------------------

export interface ResolveResult<T> {
  value: T | null;
  /** Set when the caller's explicit value disagrees with the customer's
   * recorded preference, or when nothing could be resolved. */
  error: string | null;
}

/** "Respect the customer's recorded channel": omit it → use the recorded
 * preference; supply one that disagrees → error; neither present → error.
 *
 * A recorded value outside `COMMUNICATION_CHANNELS` (e.g. a `MEETING` /
 * `VISIT` preference — `Customer.preferredContactChannel` is the full
 * `InteractionChannel` enum) is treated as **no usable preference**: the
 * caller must then name an outbound channel explicitly. This keeps a
 * non-outbound preference from either being logged verbatim as a nonsensical
 * send channel or permanently 422-ing every explicit channel. */
export function resolveChannel(
  requested: string | undefined,
  recorded: InteractionChannel | null,
): ResolveResult<InteractionChannel> {
  const usableRecorded =
    recorded !== null && isCommunicationChannel(recorded) ? recorded : null;

  if (requested !== undefined) {
    if (usableRecorded !== null && requested !== usableRecorded) {
      return {
        value: null,
        error: `channel ${requested} disagrees with the customer's recorded channel ${usableRecorded} — omit channel to use it, or update the customer's preference first`,
      };
    }
    return { value: requested as InteractionChannel, error: null };
  }
  if (usableRecorded !== null) return { value: usableRecorded, error: null };
  return {
    value: null,
    error:
      'no channel given and the customer has no usable recorded preferred channel — pass channel explicitly',
  };
}

/** "Respect the customer's recorded language": omit it → use
 * `Customer.languagePreference` (always set); supply one that disagrees →
 * error. There is deliberately no per-message language override. */
export function resolveLanguage(
  requested: string | undefined,
  recorded: LanguagePreference,
): ResolveResult<LanguagePreference> {
  if (requested !== undefined && requested !== recorded) {
    return {
      value: null,
      error: `languageUsed ${requested} disagrees with the customer's recorded language ${recorded} — omit languageUsed to use it`,
    };
  }
  return { value: recorded, error: null };
}

// --- view + audit shapes -----------------------------------------------

export interface CommunicationRow {
  id: string;
  customerId: string | null;
  channel: string;
  templateId: string | null;
  languageUsed: string | null;
  direction: string;
  subject: string | null;
  body: string | null;
  isMarketing: boolean;
  respectedConsent: boolean;
  consentRecordId: string | null;
  loggedByUserId: string | null;
  sentAt: Date;
  createdAt: Date;
}

export interface CommunicationView {
  id: string;
  customerId: string | null;
  channel: string;
  templateId: string | null;
  languageUsed: string | null;
  direction: string;
  subject: string | null;
  body: string | null;
  isMarketing: boolean;
  respectedConsent: boolean;
  consentRecordId: string | null;
  loggedByUserId: string | null;
  sentAt: string;
  createdAt: string;
}

export function deriveCommunicationView(
  row: CommunicationRow,
): CommunicationView {
  return {
    id: row.id,
    customerId: row.customerId,
    channel: row.channel,
    templateId: row.templateId,
    languageUsed: row.languageUsed,
    direction: row.direction,
    subject: row.subject,
    body: row.body,
    isMarketing: row.isMarketing,
    respectedConsent: row.respectedConsent,
    consentRecordId: row.consentRecordId,
    loggedByUserId: row.loggedByUserId,
    sentAt: row.sentAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** CREATE audit `afterValue` — structural metadata only. `subject` / `body`
 * are Confidential free text and NEVER enter an audit row (the #12
 * `RfqCommunication` / CRM `Interaction` precedent — channel + when, not the
 * body). */
export function communicationAuditSnapshot(input: {
  communicationLogId: string;
  customerId: string | null;
  channel: string;
  templateId: string | null;
  languageUsed: string | null;
  direction: string;
  isMarketing: boolean;
  respectedConsent: boolean;
  consentRecordId: string | null;
  sentAt: Date;
}): Prisma.InputJsonObject {
  return {
    communicationLogId: input.communicationLogId,
    customerId: input.customerId,
    channel: input.channel,
    templateId: input.templateId,
    languageUsed: input.languageUsed,
    direction: input.direction,
    isMarketing: input.isMarketing,
    respectedConsent: input.respectedConsent,
    consentRecordId: input.consentRecordId,
    sentAt: input.sentAt.toISOString(),
  };
}

/** Audit `afterValue` for a BLOCKED marketing send — a compliance-relevant
 * event (a marketing send was attempted without valid consent). No subject /
 * body: the send did not happen and no `CommunicationLog` row exists. */
export function blockedCommunicationAuditSnapshot(input: {
  customerId: string;
  channel: string | null;
  reason: MarketingConsentReason;
  consentRecordId: string | null;
}): Prisma.InputJsonObject {
  return {
    customerId: input.customerId,
    channel: input.channel,
    isMarketing: true,
    blocked: `marketing_consent_${input.reason}`,
    consentRecordId: input.consentRecordId,
  };
}
