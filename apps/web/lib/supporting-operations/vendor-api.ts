// Process 67 — Procurement (backlog Part C #67, Domain H). Calls apps/api's
// /vendors routes. vendor.manage (already pre-seeded). The backlog names no
// purchase-request model — this is a general Vendor record, `vendorType:
// 'other'` for the non-insurance procurement use case #67 covers.
//
// Process 71 — Vendor Management (backlog Part C #71) extends the SAME
// routes with risk tiering, the annual-review action, termination + access
// revocation, and Data Processing Agreements. `dpa.approve` (DPO only)
// gates the DPO-approval step; everything else stays under `vendor.manage`.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export interface DataProcessingAgreement {
  id: string;
  vendorId: string;
  signedAt: string | null;
  assessedByUserId: string | null;
  dpoApprovedByUserId: string | null;
  expiresAt: string | null;
}

export interface DataShareReadiness {
  vendorId: string;
  riskTier: RiskTier | null;
  ready: boolean;
  reasons: string[];
}

export const VENDOR_TYPES = [
  'insurer',
  'reinsurer',
  'loss_adjuster',
  'it_cloud',
  'printing_archiving',
  'marketing_call_centre',
  'other',
] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export interface Vendor {
  id: string;
  name: string;
  vendorType: string;
  riskTier: string | null;
  annualReviewDueAt: string | null;
  terminationDataReturnConfirmedAt: string | null;
  accessRevokedAt: string | null;
  createdAt: string;
}

/** `search` — Part F item #6 — bilingual full-text search over name. */
export function listVendors(vendorType?: string, search?: string): Promise<Vendor[]> {
  const params = new URLSearchParams();
  if (vendorType) params.set('vendorType', vendorType);
  if (search) params.set('search', search);
  const qs = params.toString();
  return apiGet(`/vendors${qs ? `?${qs}` : ''}`);
}

export function getVendor(id: string): Promise<Vendor> {
  return apiGet(`/vendors/${id}`);
}

export function createVendor(input: {
  name: string;
  vendorType: VendorType;
}): Promise<Vendor> {
  return apiPost('/vendors', input);
}

export function updateVendor(
  id: string,
  input: { name?: string; vendorType?: VendorType },
): Promise<Vendor> {
  return apiPatch(`/vendors/${id}`, input);
}

export function setVendorRiskTier(id: string, riskTier: RiskTier): Promise<Vendor> {
  return apiPatch(`/vendors/${id}/risk-tier`, { riskTier });
}

export function recordVendorAnnualReview(id: string): Promise<Vendor> {
  return apiPost(`/vendors/${id}/annual-review`);
}

export function terminateVendor(id: string): Promise<Vendor> {
  return apiPost(`/vendors/${id}/terminate`, {
    confirmDataReturnOrDestruction: true,
  });
}

export function revokeVendorAccess(id: string): Promise<Vendor> {
  return apiPost(`/vendors/${id}/revoke-access`);
}

export function getVendorDataShareReadiness(id: string): Promise<DataShareReadiness> {
  return apiGet(`/vendors/${id}/data-share-readiness`);
}

export function listVendorDpas(vendorId: string): Promise<DataProcessingAgreement[]> {
  return apiGet(`/vendors/${vendorId}/data-processing-agreements`);
}

export function createVendorDpa(vendorId: string): Promise<DataProcessingAgreement> {
  return apiPost(`/vendors/${vendorId}/data-processing-agreements`);
}

export function signDpa(id: string): Promise<DataProcessingAgreement> {
  return apiPost(`/data-processing-agreements/${id}/sign`);
}

export function dpoApproveDpa(id: string): Promise<DataProcessingAgreement> {
  return apiPost(`/data-processing-agreements/${id}/dpo-approve`);
}
