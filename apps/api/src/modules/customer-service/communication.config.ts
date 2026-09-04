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
 * `purpose = MARKETING OR isMarketing = true`). The most recent record wins
 * (`grantedAt ?? createdAt`, then `createdAt` as a stable tiebreak): consent
 * is a point-in-time state, and a fresh grant after an earlier withdrawal is
 * a valid re-opt-in. `granted && withdrawnAt == null` ⇒ allowed. Pure — no
 * DB, no `now()`.
 *
 * PDPL / `PRIV-SOP-04`: marketing consent is a distinct, opt-in control;
 * its absence is a "no", never a "maybe".
 */
export function evaluateMarketingConsent(
  records: readonly MarketingConsentRow[],
): MarketingConsentDecision {
  if (records.length === 0) {
    return { allowed: false, reason: 'no_record', consentRecordId: null };
  }
  const latest = [...records].sort((a, b) => {
    const at = (a.grantedAt ?? a.createdAt).getTime();
    const bt = (b.grantedAt ?? b.createdAt).getTime();
    if (at !== bt) return bt - at;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
  if (latest.withdrawnAt !== null) {
    return { allowed: false, reason: 'withdrawn', consentRecordId: latest.id };
  }
  if (!latest.granted) {
    return {
      allowed: false,
      reason: 'not_granted',
      consentRecordId: latest.id,
    };
  }
  return { allowed: true, reason: 'granted', consentRecordId: latest.id };
}

// --- channel / language resolution ---------------------------------------

export interface ResolveResult<T> {
  value: T | null;
  /** Set when the caller's explicit value disagrees with the customer's
   * recorded preference, or when nothing could be resolved. */
  error: string | null;
}

/** "Respect the customer's recorded channel": omit it → use the recorded
 * preference; supply one that disagrees → error; neither present → error. */
export function resolveChannel(
  requested: string | undefined,
  recorded: InteractionChannel | null,
): ResolveResult<InteractionChannel> {
  if (requested !== undefined) {
    if (recorded !== null && requested !== recorded) {
      return {
        value: null,
        error: `channel ${requested} disagrees with the customer's recorded channel ${recorded} — omit channel to use it, or update the customer's preference first`,
      };
    }
    return { value: requested as InteractionChannel, error: null };
  }
  if (recorded !== null) return { value: recorded, error: null };
  return {
    value: null,
    error:
      'no channel given and the customer has no recorded preferred channel — pass channel explicitly',
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
