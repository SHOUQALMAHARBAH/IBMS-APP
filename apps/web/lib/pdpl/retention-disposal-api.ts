// M06 — Data Retention & Secure Disposal (backlog Part D §5.1, Process #52).
// Reads/writes apps/api's /retention-schedule, /legal-holds, and
// /disposal-batches endpoints. retention-schedule.manage (Compliance/DPO)
// gates the schedule table; legal-hold.manage (DPO) gates holds;
// retention.dispose.nominate (Manager, maker) / retention.dispose.approve
// (DPO, checker) gate the dual-control disposal workflow.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export const DISPOSAL_METHODS = [
  'certified_secure_wipe_nist_800_88',
  'physical_destruction',
  'certified_shredding',
] as const;

export interface RetentionScheduleItem {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  isConfirmed: boolean;
}

export interface LegalHold {
  id: string;
  scope: string;
  reason: string;
  placedAt: string;
  nextReviewDueAt: string;
  releasedAt: string | null;
  retentionScheduleItemId: string | null;
  customerId: string | null;
  insuredPersonId: string | null;
  isActive: boolean;
}

export interface DisposalBatch {
  id: string;
  retentionScheduleItemId: string | null;
  status: string;
  nominatedByUserId: string;
  managerApprovedAt: string | null;
  dpoApprovedByUserId: string | null;
  dpoApprovedAt: string | null;
  method: string | null;
  executedAt: string | null;
  slaDueAt: string | null;
  createdAt: string;
  hasCertificateOfDestruction: boolean;
}

// --- Retention schedule -------------------------------------------

export function listRetentionSchedule(): Promise<RetentionScheduleItem[]> {
  return apiGet('/retention-schedule');
}

export function createRetentionScheduleItem(body: {
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis?: string;
}): Promise<RetentionScheduleItem> {
  return apiPost('/retention-schedule', body);
}

export function updateRetentionScheduleItem(
  id: string,
  body: { retentionPeriodMonths?: number; legalBasis?: string },
): Promise<RetentionScheduleItem> {
  return apiPatch(`/retention-schedule/${id}`, body);
}

export function confirmRetentionScheduleItem(
  id: string,
): Promise<RetentionScheduleItem> {
  return apiPost(`/retention-schedule/${id}/confirm`, {});
}

// --- Legal holds -----------------------------------------------

export function listLegalHolds(
  opts: {
    retentionScheduleItemId?: string;
    active?: boolean;
    customerId?: string;
    insuredPersonId?: string;
  } = {},
): Promise<LegalHold[]> {
  const params = new URLSearchParams();
  if (opts.retentionScheduleItemId)
    params.set('retentionScheduleItemId', opts.retentionScheduleItemId);
  if (opts.active !== undefined) params.set('active', String(opts.active));
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insuredPersonId) params.set('insuredPersonId', opts.insuredPersonId);
  const qs = params.toString();
  return apiGet(`/legal-holds${qs ? `?${qs}` : ''}`);
}

export function createLegalHold(body: {
  scope: string;
  reason: string;
  retentionScheduleItemId?: string;
  customerId?: string;
  insuredPersonId?: string;
}): Promise<LegalHold> {
  return apiPost('/legal-holds', body);
}

export function reviewLegalHold(id: string): Promise<LegalHold> {
  return apiPost(`/legal-holds/${id}/review`, {});
}

export function releaseLegalHold(id: string): Promise<LegalHold> {
  return apiPost(`/legal-holds/${id}/release`, {});
}

// --- Disposal batches --------------------------------------------

export function listDisposalBatches(
  opts: { retentionScheduleItemId?: string; status?: string } = {},
): Promise<DisposalBatch[]> {
  const params = new URLSearchParams();
  if (opts.retentionScheduleItemId)
    params.set('retentionScheduleItemId', opts.retentionScheduleItemId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/disposal-batches${qs ? `?${qs}` : ''}`);
}

export function nominateDisposalBatch(
  retentionScheduleItemId?: string,
): Promise<DisposalBatch> {
  return apiPost('/disposal-batches', { retentionScheduleItemId });
}

export function managerApproveDisposalBatch(
  id: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/manager-approve`, {});
}

export function dpoApproveDisposalBatch(id: string): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/dpo-approve`, {});
}

export function executeDisposalBatch(
  id: string,
  method: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/execute`, { method });
}

export function issueCertificateOfDestruction(
  id: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/certificate`, {});
}

export function closeDisposalBatch(id: string): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/close`, {});
}
