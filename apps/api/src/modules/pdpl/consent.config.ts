import { Prisma } from '@ibms/db';

/**
 * M03 — Consent Management (backlog Part D §5.1 / `IMPROVEMENTS.md` §5.1;
 * the backlog bundles all of Part D under Process **#52 Data Protection
 * Compliance**). The first of the nine Part D / PCMS systems to be built —
 * `ibms-brain/meta/context/pcms-privacy-modules.md`'s M01-M12 map. The pure,
 * deterministic core: the owner-validation rule and the view / audit-
 * snapshot builders.
 *
 * `ConsentRecord` is NOT a `WorkflowTransitionService` entity — it carries no
 * `status` at all, just two independently-stampable timestamps (`grantedAt`,
 * `withdrawnAt`) on an otherwise immutable row. A withdrawal never un-writes
 * `grantedAt`; the row's own history (granted, then withdrawn) IS the record
 * — `#44`'s pre-existing `evaluateMarketingConsent` (`communication.config.ts`)
 * already reads it exactly this way ("most-recent-event-wins" across every
 * `ConsentRecord` row for a purpose, not a single mutable "current" row).
 *
 * `isMarketing` is DERIVED, never accepted as input (the "computed, not an
 * input, when derivable" rule — #28/#31/#38/#44): it is `true` iff
 * `purpose === 'MARKETING'`. The model comment's "never combined with
 * contractual-necessity processing" (Part 6.3 / `PRIV-SOP-04` — consent and
 * contractual necessity are always two separate, independently-actionable
 * controls) is enforced structurally this way rather than by accepting and
 * validating a caller-supplied flag that could disagree with `purpose`.
 *
 * Governing documents (per `pcms-privacy-modules.md`'s table — cited, not
 * restated): `PRIV-STD-01` §6.3, `PRIV-SOP-04`, `PRIV-FRM-04/05`.
 */

export const CONSENT_SLA_WORKFLOW = 'consent_withdrawal';

/** Cap on a book-wide `ConsentRecord` list. */
export const CONSENT_READ_LIMIT = 5000;

export interface ConsentRecordRow {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
}

export interface ConsentRecordView {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  /** `granted && withdrawnAt === null` — an active, in-force consent. */
  isActive: boolean;
  createdAt: string;
}

export function deriveConsentView(row: ConsentRecordRow): ConsentRecordView {
  return {
    id: row.id,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    purpose: row.purpose,
    isMarketing: row.isMarketing,
    granted: row.granted,
    consentTextVersion: row.consentTextVersion,
    grantedAt: row.grantedAt ? row.grantedAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    isActive: row.granted && row.withdrawnAt === null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Exactly one of `customerId` / `insuredPersonId` must identify the data
 * subject (both are independently-nullable FKs on the model — there is no
 * DB CHECK pairing them, unlike `PaymentChannel`'s `owner_exactly_one`
 * (#38): that one guards against *concurrent* writes racing into an invalid
 * combination, which does not apply here — a `ConsentRecord` is written by
 * exactly one call site, once, at creation, never edited afterward. App-level
 * validation at that single call site is proportionate; a DB CHECK would be
 * the right call if a second creation path ever appears). */
export function hasExactlyOneOwner(input: {
  customerId?: string;
  insuredPersonId?: string;
}): boolean {
  return Boolean(input.customerId) !== Boolean(input.insuredPersonId);
}

/** CREATE audit `afterValue` — ids + purpose + the decision. No free text:
 * the model has none (`consentTextVersion` is a version label, not a
 * capture point for anything Highly Confidential). */
export function consentAuditSnapshot(input: {
  consentRecordId: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
}): Prisma.InputJsonObject {
  return {
    consentRecordId: input.consentRecordId,
    customerId: input.customerId,
    insuredPersonId: input.insuredPersonId,
    purpose: input.purpose,
    isMarketing: input.isMarketing,
    granted: input.granted,
    consentTextVersion: input.consentTextVersion,
  };
}

/** UPDATE audit `afterValue` — the withdrawal-reflected event only. */
export function consentWithdrawalAuditSnapshot(input: {
  consentRecordId: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  withdrawnAt: Date;
}): Prisma.InputJsonObject {
  return {
    consentRecordId: input.consentRecordId,
    customerId: input.customerId,
    insuredPersonId: input.insuredPersonId,
    purpose: input.purpose,
    withdrawnAt: input.withdrawnAt.toISOString(),
  };
}
