// Process 3-4 — the KYC lifecycle. Talks to apps/api's kyc.controller.ts.
// Mirrors lib/lead/lead-api.ts's conventions.

import { apiGet, apiPost } from '../auth/api-client';

export type KycStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'SCREENING'
  | 'EDD'
  | 'COMPLIANCE_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PERIODIC_REVIEW_DUE';

export interface KycRecord {
  id: string;
  customerId: string;
  status: KycStatus;
  isEdd: boolean;
  submittedAt: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  nextReviewDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// GET /kyc-records only (the Compliance queue) enriches each row with just
// enough of the parent Customer to render without an extra per-row fetch —
// see KycRecordRepository.findMany's `include` (apps/api). Neither
// legalName nor customerType is sensitive.
export interface KycQueueRecord extends KycRecord {
  customer: { legalName: string; customerType: 'INDIVIDUAL' | 'CORPORATE' };
}

export interface ListKycRecordsFilter {
  status?: KycStatus;
  customerId?: string;
}

export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  SCREENING: 'Screening',
  EDD: 'Enhanced due diligence',
  COMPLIANCE_REVIEW: 'Compliance review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PERIODIC_REVIEW_DUE: 'Periodic review due',
};

export function startKyc(customerId: string): Promise<KycRecord> {
  return apiPost(`/customers/${customerId}/kyc`, undefined);
}

export function submitKyc(kycId: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/submit`, undefined);
}

export function runScreening(kycId: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/run-screening`, undefined);
}

export function rerunScreening(kycId: string): Promise<unknown> {
  return apiPost(`/kyc-records/${kycId}/rerun-screening`, undefined);
}

export function triggerEdd(kycId: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/trigger-edd`, undefined);
}

export function approveKyc(kycId: string, reason?: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/approve`, { reason });
}

export function rejectKyc(kycId: string, reason: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/reject`, { reason });
}

export function scheduleReview(kycId: string, nextReviewDueAt?: string): Promise<KycRecord> {
  return apiPost(`/kyc-records/${kycId}/schedule-review`, { nextReviewDueAt });
}

export function listKycRecords(filter: ListKycRecordsFilter = {}): Promise<KycQueueRecord[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.customerId) params.set('customerId', filter.customerId);
  const qs = params.toString();
  return apiGet(`/kyc-records${qs ? `?${qs}` : ''}`);
}

export function getKycRecord(kycId: string): Promise<KycRecord> {
  return apiGet(`/kyc-records/${kycId}`);
}
