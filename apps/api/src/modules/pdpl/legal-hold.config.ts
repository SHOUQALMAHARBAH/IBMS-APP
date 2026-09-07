import { Prisma } from '@ibms/db';

/**
 * M06 — Legal Hold (backlog Part D §5.1, Process #52). Records under an
 * active Legal Hold (`releasedAt IS NULL`) are excluded from routine
 * disposal — `DisposalBatchService`'s own guard, checked via
 * `LegalHoldRepository.hasActiveHold()` at every dual-control step
 * (nominate, manager-approve, dpo-approve), not just once at creation.
 * Reviewed every 6 months — `SLA_REGISTRY`'s `legal_hold_necessity_review`
 * entry, pre-seeded ahead of any application code, this module's first
 * real consumer.
 *
 * **`customerId`/`insuredPersonId` (a later widening, migration
 * `20260916120000`) let a hold name ONE data subject structurally**, not
 * just in `scope`'s free text — closing the M04/M06 integration gap
 * `fulfil-dsr.dto.ts`'s own header comment used to flag as a TODO: at most
 * one of the two may be set (`hasAtMostOneSubjectReference`, the
 * `hasExactlyOneOwner`/`hasExactlyOneConsentOwner` shape, but "at most"
 * rather than "exactly" — a hold can legitimately name neither and rely on
 * `scope`/`retentionScheduleItemId` alone, exactly as before this
 * widening). `LegalHoldRepository.hasActiveHoldForSubject()` is the live
 * check `DsrService.fulfil()` now runs before letting a DELETION request
 * close as fully fulfilled — a REAL block when a hold actually names this
 * subject, not just a staff attestation.
 */

export const LEGAL_HOLD_REVIEW_SLA_WORKFLOW = 'legal_hold_necessity_review';

/** At most one of customerId/insuredPersonId — both may be absent (a pure
 * category- or scope-text-only hold, the pre-widening shape), but never
 * both present (which of the two names the subject would be ambiguous). */
export function hasAtMostOneSubjectReference(input: {
  customerId?: string | null;
  insuredPersonId?: string | null;
}): boolean {
  return !(input.customerId && input.insuredPersonId);
}

export interface LegalHoldRow {
  id: string;
  scope: string;
  reason: string;
  placedAt: Date;
  nextReviewDueAt: Date;
  releasedAt: Date | null;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
}

export interface LegalHoldView {
  id: string;
  scope: string;
  reason: string;
  placedAt: string;
  nextReviewDueAt: string;
  releasedAt: string | null;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
  /** `releasedAt === null` — this hold is currently in force. */
  isActive: boolean;
}

export function deriveLegalHoldView(row: LegalHoldRow): LegalHoldView {
  return {
    id: row.id,
    scope: row.scope,
    reason: row.reason,
    placedAt: row.placedAt.toISOString(),
    nextReviewDueAt: row.nextReviewDueAt.toISOString(),
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    retentionScheduleItemId: row.retentionScheduleItemId,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    isActive: row.releasedAt === null,
  };
}

/** `scope`/`reason` carried verbatim — the DSR precedent
 * (`dsr.config.ts`'s `dsrUpdateAuditSnapshot`): an operational
 * business-action note (why a hold was placed, over what), not a data
 * subject's own subjective text, so unlike #45's `comments` it is not
 * excluded here. A DPO reviewing the audit trail needs to see WHY a hold
 * exists, not just that one does. */
export function legalHoldAuditSnapshot(
  row: LegalHoldRow,
): Prisma.InputJsonObject {
  return {
    legalHoldId: row.id,
    scope: row.scope,
    reason: row.reason,
    retentionScheduleItemId: row.retentionScheduleItemId,
    customerId: row.customerId,
    insuredPersonId: row.insuredPersonId,
    isActive: row.releasedAt === null,
  };
}
