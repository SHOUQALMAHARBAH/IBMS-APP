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
 */

export const LEGAL_HOLD_REVIEW_SLA_WORKFLOW = 'legal_hold_necessity_review';

export interface LegalHoldRow {
  id: string;
  scope: string;
  reason: string;
  placedAt: Date;
  nextReviewDueAt: Date;
  releasedAt: Date | null;
  retentionScheduleItemId: string | null;
}

export interface LegalHoldView {
  id: string;
  scope: string;
  reason: string;
  placedAt: string;
  nextReviewDueAt: string;
  releasedAt: string | null;
  retentionScheduleItemId: string | null;
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
    isActive: row.releasedAt === null,
  };
}
