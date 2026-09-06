// Process 67 — Procurement (backlog Part C #67, Domain H). Calls apps/api's
// /vendors routes. vendor.manage (already pre-seeded). The backlog names no
// purchase-request model — this is a general Vendor record, `vendorType:
// 'other'` for the non-insurance procurement use case #67 covers.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

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

export function listVendors(vendorType?: string): Promise<Vendor[]> {
  return apiGet(
    vendorType ? `/vendors?vendorType=${encodeURIComponent(vendorType)}` : '/vendors',
  );
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
