// M04 — Data Subject Request Management (backlog Part D, bundled under
// Process #52 "Data Protection Compliance"). Reads/writes apps/api's /dsr
// endpoints. dsr.log (broad) gates create+read; dsr.handle (DPO-only) gates
// every working action; dsr.close (DPO-only) gates the mandatory-sign-off
// closure.

import { apiGet, apiPost } from '../auth/api-client';

export const DSR_TYPES = ['ACCESS', 'CORRECTION', 'DELETION', 'OBJECTION'];

export interface DataSubjectRequest {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  type: string;
  status: string;
  receivedAt: string;
  identityVerifiedAt: string | null;
  slaDueAt: string;
  accessExtensionAppliedAt: string | null;
  extensionReason: string | null;
  retentionScheduleReference: string | null;
  partialFulfilmentJustification: string | null;
  closedAt: string | null;
  dpoHandlerUserId: string | null;
  processedByUserId: string | null;
  closedByUserId: string | null;
  rejectionReason: string | null;
  noOpenRetentionHoldConfirmedAt: string | null;
  isOverdue: boolean;
  createdAt: string;
}

export function listDsrs(
  opts: {
    customerId?: string;
    insuredPersonId?: string;
    status?: string;
    type?: string;
    dpoHandlerUserId?: string;
  } = {},
): Promise<DataSubjectRequest[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insuredPersonId) params.set('insuredPersonId', opts.insuredPersonId);
  if (opts.status) params.set('status', opts.status);
  if (opts.type) params.set('type', opts.type);
  if (opts.dpoHandlerUserId) params.set('dpoHandlerUserId', opts.dpoHandlerUserId);
  const qs = params.toString();
  return apiGet(`/dsr${qs ? `?${qs}` : ''}`);
}

export function createDsr(body: {
  customerId?: string;
  insuredPersonId?: string;
  type: string;
}): Promise<DataSubjectRequest> {
  return apiPost('/dsr', body);
}

export function verifyDsrIdentity(id: string): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/verify-identity`, {});
}

export function startDsr(id: string): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/start`, {});
}

export function assignDsr(
  id: string,
  dpoHandlerUserId: string,
): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/assign`, { dpoHandlerUserId });
}

export function applyDsrExtension(
  id: string,
  reason: string,
): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/apply-extension`, { reason });
}

export function fulfilDsr(
  id: string,
  confirmNoOpenRetentionHold?: boolean,
): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/fulfil`, { confirmNoOpenRetentionHold });
}

export function partiallyFulfilDsr(
  id: string,
  body: { retentionScheduleReference: string; partialFulfilmentJustification: string },
): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/partially-fulfil`, body);
}

export function rejectDsr(id: string, reason: string): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/reject`, { reason });
}

export function closeDsr(id: string): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/close`, {});
}
