import type { Prisma } from '@ibms/db';

/**
 * Part 9.3 — Records of Processing Activities (backlog Part D §5.1,
 * Process #52). "An exportable register documenting every processing
 * activity, its data categories, purposes, recipients, and retention
 * period." `ropa.manage` (DPO-only) gates the whole surface — plain,
 * fully-mutable CRUD (unlike `PrivacyNotice`'s append-only versioning):
 * a RoPA register entry is a living description of an ongoing activity,
 * corrected/updated in place as the activity's own data categories or
 * recipients change, the `KnowledgeBaseArticle` mutability shape rather
 * than `PrivacyNotice`'s immutable-history one.
 *
 * `RopaEntry` carries no actor column (`createdByUserId`/`updatedByUserId`)
 * — the `AuditLogEntry` trail already records who wrote each row; adding a
 * redundant column the model doesn't have would be schema change beyond
 * what the checklist actually asks for.
 *
 * **"Exportable"** reuses the #65 Strategic Planning Inputs precedent — the
 * previously-dormant `AuditAction.EXPORT` value, an `EXPORT` audit row with
 * a synthetic `entityId` (there is no single row being exported) — not a
 * real CSV/file-download mechanism, since none exists anywhere else in
 * this codebase either.
 */
export interface RopaEntryRow {
  id: string;
  processingActivity: string;
  categoriesOfData: string[];
  purpose: string;
  recipients: string[];
  retentionPeriodMonths: number | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface RopaEntryView {
  id: string;
  processingActivity: string;
  categoriesOfData: string[];
  purpose: string;
  recipients: string[];
  retentionPeriodMonths: number | null;
  updatedAt: string;
  createdAt: string;
}

export function deriveRopaEntryView(row: RopaEntryRow): RopaEntryView {
  return {
    id: row.id,
    processingActivity: row.processingActivity,
    categoriesOfData: row.categoriesOfData,
    purpose: row.purpose,
    recipients: row.recipients,
    retentionPeriodMonths: row.retentionPeriodMonths,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function ropaEntryAuditSnapshot(
  row: RopaEntryRow,
): Prisma.InputJsonObject {
  return {
    ropaEntryId: row.id,
    processingActivity: row.processingActivity,
    categoriesOfData: row.categoriesOfData,
    purpose: row.purpose,
    recipients: row.recipients,
    retentionPeriodMonths: row.retentionPeriodMonths,
  };
}

export interface RopaExportSummary {
  generatedAt: string;
  entryCount: number;
  entries: RopaEntryView[];
}

export function ropaExportAuditSnapshot(
  summary: RopaExportSummary,
): Prisma.InputJsonObject {
  return {
    generatedAt: summary.generatedAt,
    entryCount: summary.entryCount,
  };
}
