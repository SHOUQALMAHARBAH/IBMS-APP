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
  actorRoleIds: string[];
  actorRoleNames: string[];
  occurredAt: Date;
}

/**
 * One person who appears as an actor in the audit log. Identifiers and a name — never a role, never an
 * email: this backs a filter control, and the roles an actor HELD are already on the rows themselves.
 */
export interface AuditActorView {
  id: string;
  fullName: string;
}

export interface AuditLogEntryView {
  id: string;
  userId: string;
  /**
   * Who that id IS, resolved for display.
   *
   * The screen rendered `userId` — a raw uuid — in a column headed "User", which is unreadable by the
   * person the audit trail exists for.
   *
   * Typed nullable because it is a LOOKUP, and `null` is what a lookup that missed returns. On this
   * schema it cannot miss, and that is worth writing down rather than trusting: `userId` is NOT NULL,
   * `AuditLogEntry_userId_fkey` is ON DELETE RESTRICT (measured, not read off the schema — the
   * declaration has been wrong about an onDelete before), and both reads are scoped to the same office.
   * So an actor cannot be deleted out from under their own audit rows, and the screen's fallback to the
   * id is defence against a future change to any one of those three, not a state you can reach today.
   * There is a test that keeps the RESTRICT true.
   *
   * Deliberately NOT stored on the row. `actorRoleNames` is stored because a role held in the past and
   * then revoked is unrecoverable; a NAME is recoverable by lookup, and resolving it means the reader
   * sees who the person is TODAY, which is what "who did this" asks. A stored copy would also be a
   * second place a rename has to reach.
   */
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Prisma.JsonValue | null;
  afterValue: Prisma.JsonValue | null;
  isSensitiveDataAccess: boolean;
  /** The roles the actor HELD at the moment of the action, as stored on the entry — not resolved
   *  from their present assignments. Empty means the write had no authenticated actor (a
   *  scheduled sweep, a seed), or predates migration `20261017100000`. */
  actorRoleIds: string[];
  actorRoleNames: string[];
  occurredAt: string;
}

export function deriveAuditLogEntryView(
  row: AuditLogEntryRow,
  /** Resolved names for the page, keyed by user id. Absent for the two history reads. */
  names?: Map<string, string>,
): AuditLogEntryView {
  return {
    id: row.id,
    userId: row.userId,
    actorName: names?.get(row.userId) ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    isSensitiveDataAccess: row.isSensitiveDataAccess,
    actorRoleIds: row.actorRoleIds,
    actorRoleNames: row.actorRoleNames,
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
