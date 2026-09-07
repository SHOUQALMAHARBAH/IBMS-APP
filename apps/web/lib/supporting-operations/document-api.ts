// Process 70 — Document Management (backlog Part C #70, Domain H). Calls
// apps/api's /documents routes — version control + the deletion-lock
// override for the Part 4.2 electronic Insurance File. document.manage
// gates the general surface; document.delete-override (narrower, ADMIN/DPO)
// gates the two deletion routes.

import { apiDelete, apiGet, apiPost } from '../auth/api-client';

export const DOCUMENT_CATEGORIES = [
  'APPLICATION_PROPOSAL',
  'RISK_SURVEY',
  'QUOTATION',
  'COMPARISON',
  'RECOMMENDATION',
  'CLIENT_APPROVAL',
  'POLICY',
  'ENDORSEMENT',
  'INVOICE',
  'RECEIPT',
  'CLAIM',
  'CORRESPONDENCE',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export interface DocumentRecord {
  id: string;
  policyId: string | null;
  customerId: string | null;
  category: DocumentCategory;
  classification: DataClassification;
  fileName: string;
  storageRef: string;
  versionNumber: number;
  previousVersionId: string | null;
  uploadedByUserId: string;
  deletionLocked: boolean;
  deletionOverrideByUserId: string | null;
  createdAt: string;
}

export interface PolicyFileClassificationSummary {
  policyId: string;
  documentCount: number;
  highestClassification: DataClassification | null;
}

export function listDocuments(filter?: {
  policyId?: string;
  customerId?: string;
}): Promise<DocumentRecord[]> {
  const params = new URLSearchParams();
  if (filter?.policyId) params.set('policyId', filter.policyId);
  if (filter?.customerId) params.set('customerId', filter.customerId);
  const query = params.toString();
  return apiGet(`/documents${query ? `?${query}` : ''}`);
}

export function createDocumentVersion(
  id: string,
  input: { classification: DataClassification; fileName: string; storageRef: string },
): Promise<DocumentRecord> {
  return apiPost(`/documents/${id}/versions`, input);
}

export function overrideDeletionLock(id: string): Promise<DocumentRecord> {
  return apiPost(`/documents/${id}/deletion-override`);
}

export function deleteDocument(id: string): Promise<void> {
  return apiDelete(`/documents/${id}`);
}

export function getPolicyFileClassification(
  policyId: string,
): Promise<PolicyFileClassificationSummary> {
  return apiGet(`/documents/classification-summary?policyId=${policyId}`);
}
