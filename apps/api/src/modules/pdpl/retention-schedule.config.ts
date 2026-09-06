import { Prisma } from '@ibms/db';

/**
 * M06 — Data Retention (backlog Part D §5.1, Process #52). The
 * `RetentionScheduleItem` table itself: "a documented retention-period
 * table" per record category, pending Legal Counsel confirmation.
 *
 * **No specific per-category retention period is sourced anywhere in this
 * brain today.** `PRIV-STD-03` (the governing document — see
 * `ibms-brain/meta/context/pcms-privacy-modules.md`'s M06 row) is where the
 * real table lives; engineering has never been handed its contents. The one
 * existing seed row (`recordCategory: "AuditLogEntry"`, 120 months) is a
 * documented ENGINEERING-INVENTED DRAFT pending a real citation — see
 * `packages/db/prisma/seed-data/retention-schedule.ts`'s own header comment
 * and `ibms-brain/meta/context/data-retention-and-disposal.md`. This module
 * does not invent any more draft figures than that one already-flagged
 * row — it only builds the CRUD so Compliance/DPO staff can add real rows
 * and confirm them once the table exists, which is exactly what "needs
 * Legal Counsel confirmation as a pending input" (the backlog's own phrase)
 * describes.
 */

export interface RetentionScheduleItemRow {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: Date | null;
}

export interface RetentionScheduleItemView {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  /** `confirmedByLegalCounselAt !== null` — a plain convenience flag so a
   * caller never has to derive "is this confirmed?" from a nullable
   * timestamp itself. */
  isConfirmed: boolean;
}

export function deriveRetentionScheduleItemView(
  row: RetentionScheduleItemRow,
): RetentionScheduleItemView {
  return {
    id: row.id,
    recordCategory: row.recordCategory,
    retentionPeriodMonths: row.retentionPeriodMonths,
    legalBasis: row.legalBasis,
    confirmedByLegalCounselAt: row.confirmedByLegalCounselAt
      ? row.confirmedByLegalCounselAt.toISOString()
      : null,
    isConfirmed: row.confirmedByLegalCounselAt !== null,
  };
}

export function retentionScheduleItemAuditSnapshot(
  row: RetentionScheduleItemRow,
): Prisma.InputJsonObject {
  return {
    retentionScheduleItemId: row.id,
    recordCategory: row.recordCategory,
    retentionPeriodMonths: row.retentionPeriodMonths,
    isConfirmed: row.confirmedByLegalCounselAt !== null,
  };
}
