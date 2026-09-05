// Process 57's second checkbox — the External Auditor's read-only lens
// over the audit log, document history, and workflow history. Reads
// apps/api's /audit-trail endpoints. audit-log.read /
// document-history.read / workflow-history.read.

import { apiGet } from '../auth/api-client';

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
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
  category: string;
  classification: string;
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

export function browseAuditTrail(filters: {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
}): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
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
