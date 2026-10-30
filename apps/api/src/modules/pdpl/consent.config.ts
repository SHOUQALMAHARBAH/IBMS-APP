import { Prisma } from '@ibms/db';
import { hasExactlyOneOwner } from '../../common/dto.util';

export { hasExactlyOneOwner };

/** Consent's own three-way owner check — customerId / insuredPersonId /
 * leadId (lead capture, the one touchpoint that pre-dates a Customer row).
 * Deliberately NOT a generalization of the shared `hasExactlyOneOwner`
 * (DSR's own two-way check reuses that one and has no `leadId` concept) —
 * a local, Consent-specific validator instead, so DSR's shape stays
 * untouched. */
export function hasExactlyOneConsentOwner(input: {
  customerId?: string | null;
  insuredPersonId?: string | null;
  leadId?: string | null;
}): boolean {
  const ownerCount = [
    input.customerId,
    input.insuredPersonId,
    input.leadId,
  ].filter(Boolean).length;
  return ownerCount === 1;
}

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
  leadId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  /**
   * Batch six item 2, rule 2 — the register's Subject column rendered `Lead <8 chars of a uuid>`
   * or a bare sliced uuid, so nobody could tell whose consent each row records. That is the one
   * column a consent register exists for.
   *
   * THREE RELATIONS BECAUSE A RECORD NAMES ONE OF THREE SUBJECTS, and the service validates that at
   * most one is set. All three are REQUIRED FIELDS with NULLABLE VALUES: required is what makes the
   * compiler name every path that builds a row (an optional field would let a write project
   * `undefined` — a name after a LIST and none after a GRANT), and nullable is the truth, since two
   * of the three are always absent.
   *
   * Every one of the three name columns is NOT NULL on its own model (`Customer.legalName`,
   * `Lead.fullName`, `InsuredPerson.fullName`), so whenever a subject is named there is a name.
   */
  customer: { legalName: string } | null;
  lead: { fullName: string } | null;
  insuredPerson: { fullName: string } | null;
}

export interface ConsentRecordView {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  leadId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  /** `granted && withdrawnAt === null` — an active, in-force consent. */
  isActive: boolean;
  createdAt: string;
  /**
   * Whichever subject this record names, BY NAME. Null only when the record names none — which the
   * service forbids, so in practice this is always set; it is nullable because the three id columns
   * are, and a view that claimed otherwise would be asserting a rule it does not enforce.
   *
   * The KIND is deliberately NOT on the wire: the screen already has the three ids and can see
   * which one is set, so sending a `subjectKind` beside them would be a second home for one fact —
   * and the copy is the one that drifts.
   */
  subjectName: string | null;
}

export function deriveConsentView(row: ConsentRecordRow): ConsentRecordView {
  return {
    id: row.id,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    leadId: row.leadId,
    purpose: row.purpose,
    isMarketing: row.isMarketing,
    granted: row.granted,
    consentTextVersion: row.consentTextVersion,
    grantedAt: row.grantedAt ? row.grantedAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    isActive: row.granted && row.withdrawnAt === null,
    createdAt: row.createdAt.toISOString(),
    /*
     * The ORDER is immaterial rather than a precedence rule: the service allows at most one of the
     * three, so at most one of these is ever non-null. Written as a chain rather than a branch on
     * the ids so that a record whose id and relation ever disagreed could not render a name from
     * one subject beside the id of another.
     */
    subjectName:
      row.customer?.legalName ??
      row.lead?.fullName ??
      row.insuredPerson?.fullName ??
      null,
  };
}

/** CREATE audit `afterValue` — ids + purpose + the decision. No free text:
 * the model has none (`consentTextVersion` is a version label, not a
 * capture point for anything Highly Confidential). */
export function consentAuditSnapshot(input: {
  consentRecordId: string;
  customerId: string | null;
  insuredPersonId: string | null;
  leadId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
}): Prisma.InputJsonObject {
  return {
    consentRecordId: input.consentRecordId,
    customerId: input.customerId,
    insuredPersonId: input.insuredPersonId,
    leadId: input.leadId,
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
