// M08 — Third Parties & Data Sharing (backlog Part D §5.1, Process #52).
// data-sharing.request (maker) gates create; data-sharing.approve (DPO,
// checker) gates approve/decline.

import { apiGet, apiPost } from '../auth/api-client';

export const DATA_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;

export const DATA_SHARING_CHANNELS = [
  'SECURE_SFTP',
  'ENCRYPTED_EMAIL',
  'VENDOR_SECURE_PORTAL',
  'CBJ_REGULATORY_PORTAL',
  'IN_PERSON_ENCRYPTED_MEDIA',
  'UNENCRYPTED_EMAIL',
  'POSTAL_MAIL',
  'OTHER_UNSECURED',
] as const;

export interface DataSharingApproval {
  id: string;
  vendorId: string | null;
  description: string;
  classification: string;
  channel: string;
  isRegulatoryChannel: boolean;
  requestedByUserId: string;
  approvedByUserId: string | null;
  slaDueAt: string;
  decidedAt: string | null;
  createdAt: string;
  isApproved: boolean;
  isDeclined: boolean;
  isPending: boolean;
}

export function listDataSharingApprovals(
  opts: { vendorId?: string; classification?: string; pendingOnly?: boolean } = {},
): Promise<DataSharingApproval[]> {
  const params = new URLSearchParams();
  if (opts.vendorId) params.set('vendorId', opts.vendorId);
  if (opts.classification) params.set('classification', opts.classification);
  if (opts.pendingOnly !== undefined) params.set('pendingOnly', String(opts.pendingOnly));
  const qs = params.toString();
  return apiGet(`/data-sharing-approvals${qs ? `?${qs}` : ''}`);
}

export function createDataSharingApproval(body: {
  vendorId?: string;
  description: string;
  classification: string;
  channel: string;
  isRegulatoryChannel?: boolean;
}): Promise<DataSharingApproval> {
  return apiPost('/data-sharing-approvals', body);
}

export function approveDataSharingApproval(id: string): Promise<DataSharingApproval> {
  return apiPost(`/data-sharing-approvals/${id}/approve`, {});
}

export function declineDataSharingApproval(id: string): Promise<DataSharingApproval> {
  return apiPost(`/data-sharing-approvals/${id}/decline`, {});
}
