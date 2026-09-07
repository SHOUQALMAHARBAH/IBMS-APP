import {
  AuditAction,
  type DataClassification,
  type DocumentCategory,
} from '@ibms/db';
import type { Prisma } from '@ibms/db';

/**
 * Process 57 (backlog Part C #57's second checkbox, Domain F — closes
 * Domain F) — "Time-boxed read-only access for the External Auditor role
 * across all records, documents, and workflow history." Part 5.1's own
 * role table (`ibms-brain/meta/context/roles-and-segregation-of-duties.md`)
 * names the scope precisely: "Read-only access to **logs, documents and
 * workflow history** for a defined engagement period" — not blanket read
 * access to every business table's live content. "Time-boxed" is already a
 * generic, existing mechanism (`User.accessValidUntil`,
 * `SessionService.validate` — see the Auth e2e's own "External Auditor
 * time-boxed access (Part 5.1)" suite); this module is what "logs,
 * documents, and workflow history" itself does, since `audit-log.read` /
 * `document-history.read` / `workflow-history.read` were pre-seeded ahead
 * of time with no controller ever consuming them until now.
 *
 * All three lenses read the SAME table, `AuditLogEntry` — polymorphic
 * across every entity type in the schema, so "all records" is satisfied by
 * the audit trail spanning all of them, not by granting live read access
 * to each business table directly (a materially smaller, more defensible
 * grant than the alternative reading of the backlog's "all records"
 * phrasing — see `ibms-brain/meta/context/internal-audit-and-external-
 * auditor-access.md` for the reasoning).
 */

export const AUDIT_ACTIONS: string[] = Object.values(AuditAction);

/** Cap on a book-wide `AuditLogEntry` browse — these are all workflow/
 * compliance tables an auditor filters down, not an unbounded log-shipping
 * export. */
export const AUDIT_TRAIL_READ_LIMIT = 5000;

/** Safety valve on a `Document` version-chain walk — a genuine chain is a
 * handful of revisions; this only guards against a data anomaly (a cycle)
 * ever turning the walk into an infinite loop. */
export const DOCUMENT_VERSION_CHAIN_WALK_LIMIT = 1000;

export interface AuditLogEntryRow {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Prisma.JsonValue | null;
  afterValue: Prisma.JsonValue | null;
  isSensitiveDataAccess: boolean;
  occurredAt: Date;
}

export interface AuditLogEntryView {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Prisma.JsonValue | null;
  afterValue: Prisma.JsonValue | null;
  isSensitiveDataAccess: boolean;
  occurredAt: string;
}

export function deriveAuditLogEntryView(
  row: AuditLogEntryRow,
): AuditLogEntryView {
  return {
    id: row.id,
    userId: row.userId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    isSensitiveDataAccess: row.isSensitiveDataAccess,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export interface DocumentVersionRow {
  id: string;
  versionNumber: number;
  fileName: string;
  category: DocumentCategory;
  classification: DataClassification;
  uploadedByUserId: string;
  deletionLocked: boolean;
  deletionOverrideByUserId: string | null;
  createdAt: Date;
  previousVersionId: string | null;
}

export interface DocumentVersionView {
  id: string;
  versionNumber: number;
  fileName: string;
  category: DocumentCategory;
  classification: DataClassification;
  uploadedByUserId: string;
  deletionLocked: boolean;
  deletionOverrideByUserId: string | null;
  createdAt: string;
  isRequestedVersion: boolean;
}

export interface DocumentHistoryView {
  requestedDocumentId: string;
  versions: DocumentVersionView[];
  auditTrail: AuditLogEntryView[];
}

/** Pure: given the full version chain (any order) and the requested id,
 * order oldest-to-newest by `versionNumber` and flag which row was asked
 * for. Deterministic — `versionNumber` is set once at creation and never
 * mutated, so ties can only mean a data anomaly, not a legitimate
 * ordering ambiguity (unlike #53-54's `expiresAt` tiebreak). */
export function buildDocumentVersionViews(
  chain: DocumentVersionRow[],
  requestedDocumentId: string,
): DocumentVersionView[] {
  return [...chain]
    .sort((a, b) => a.versionNumber - b.versionNumber)
    .map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      fileName: v.fileName,
      category: v.category,
      classification: v.classification,
      uploadedByUserId: v.uploadedByUserId,
      deletionLocked: v.deletionLocked,
      deletionOverrideByUserId: v.deletionOverrideByUserId,
      createdAt: v.createdAt.toISOString(),
      isRequestedVersion: v.id === requestedDocumentId,
    }));
}
