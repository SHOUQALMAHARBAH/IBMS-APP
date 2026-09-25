// Process 57's second checkbox — the External Auditor's read-only lens
// over the audit log, document history, and workflow history. Reads
// apps/api's /audit-trail endpoints. audit-log.read /
// document-history.read / workflow-history.read.

import type { Paginated } from '../api/paginated';
import { apiGet } from '../auth/api-client';

export type AuditAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'REJECT'
  | 'TRANSITION'
  | 'EXPORT'
  | 'PRINT'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'MFA_ENROLLED'
  | 'MFA_VERIFIED'
  | 'MFA_FAILED'
  | 'STEP_UP_VERIFIED'
  | 'ACCESS_WINDOW_EXPIRED';

export type DocumentCategory =
  | 'APPLICATION_PROPOSAL'
  | 'RISK_SURVEY'
  | 'QUOTATION'
  | 'COMPARISON'
  | 'RECOMMENDATION'
  | 'CLIENT_APPROVAL'
  | 'POLICY'
  | 'ENDORSEMENT'
  | 'INVOICE'
  | 'RECEIPT'
  | 'CLAIM'
  | 'CORRESPONDENCE'
  | 'OTHER';

export type DataClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'HIGHLY_CONFIDENTIAL';

/** One person who appears as an actor in the audit log — the actor picker's option shape. */
export interface AuditActor {
  id: string;
  fullName: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  /** Who that id is. Nullable because it is a lookup; unreachable in practice because the actor FK is
   *  ON DELETE RESTRICT and `userId` is NOT NULL. The screen falls back to the id anyway. */
  actorName: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  beforeValue: unknown;
  afterValue: unknown;
  isSensitiveDataAccess: boolean;
  occurredAt: string;
}

export interface DocumentVersion {
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

export interface DocumentHistory {
  requestedDocumentId: string;
  versions: DocumentVersion[];
  auditTrail: AuditLogEntry[];
}

/**
 * The people who appear in this office's audit log, by name.
 *
 * Gated by `audit-log.read`, the same permission as the log — NOT `user.manage`. Compliance and the
 * external auditor read the audit trail and hold no user-administration permission at all, so the admin
 * user list would have refused exactly the people this control is for.
 */
export function listAuditActors(search?: string): Promise<AuditActor[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  return apiGet(`/audit-trail/actors${qs}`);
}

export function browseAuditTrail(filters: {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  /** 0-based. Omitted on the first page, so the common request keeps the URL
   *  it has always had. */
  page?: number;
}): Promise<Paginated<AuditLogEntry>> {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.page) params.set('page', String(filters.page));
  const qs = params.toString();
  return apiGet(`/audit-trail${qs ? `?${qs}` : ''}`);
}

export function getWorkflowHistory(
  entityType: string,
  entityId: string,
): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams({ entityType, entityId });
  return apiGet(`/audit-trail/workflow-history?${params.toString()}`);
}

export function getDocumentHistory(
  documentId: string,
): Promise<DocumentHistory> {
  return apiGet(`/audit-trail/documents/${documentId}/history`);
}
