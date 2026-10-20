// M06 — Data Retention & Secure Disposal (backlog Part D §5.1, Process #52).
// Reads/writes apps/api's /retention-schedule, /legal-holds, and
// /disposal-batches endpoints. retention-schedule.manage (Compliance/DPO)
// gates the schedule table; legal-hold.manage (DPO) gates holds;
// retention.dispose.nominate (Manager, maker) / retention.dispose.approve
// (DPO, checker) gate the dual-control disposal workflow.

import { apiGet, apiPatch, apiPost } from '../auth/api-client';
import type { CombinedDutyActOnRecord } from '../../components/ui/CombinedDutyOnRecord';

export const DISPOSAL_METHODS = [
  'certified_secure_wipe_nist_800_88',
  'physical_destruction',
  'certified_shredding',
] as const;

export type DisposalBatchStatus =
  | 'NOMINATED'
  | 'MANAGER_APPROVED'
  | 'DPO_APPROVED'
  | 'EXECUTED'
  | 'CLOSED';

/**
 * TEN — the minimum length of a declaration's written reason, mirroring the api's single home for
 * that figure (`apps/api/src/common/declaration-reason.ts`).
 *
 * A hand-copied constant over an HTTP boundary is exactly the drift class this repo has paid for,
 * so the api REPORTS it: every `NO_FLOOR_DECLARATION_REQUIRED` body carries `reasonMinLength`, and
 * an api e2e asserts that the reported figure equals this one. The constant is the screen's default
 * so a disabled button does not depend on a round trip.
 */
export const NO_FLOOR_REASON_MIN_LENGTH = 10;

/** The office's declaration for a category this system knows no statutory minimum for. */
export interface NoFloorDeclarationInput {
  /** The sentence as RENDERED — carried so the record says what the office was actually shown. */
  noticeShown: string;
  reason: string;
  acknowledged: true;
}

export interface RetentionScheduleItem {
  id: string;
  recordCategory: string;
  retentionPeriodMonths: number;
  legalBasis: string | null;
  confirmedByLegalCounselAt: string | null;
  isConfirmed: boolean;
  /**
   * THE SIXTEENTH PAIR'S ACT, ON THE RECORD. Null for every ordinary two-person confirmation,
   * which is nearly all of them — `CombinedDutyOnRecord` renders nothing in that case.
   */
  combinedDutyAct: CombinedDutyActOnRecord | null;
  /**
   * The no-floor declaration, if this category ever needed one. Carries the SENTENCE the office was
   * shown, not the word "acknowledged" — a year from now the question is what they saw.
   */
  noFloorDeclaration: {
    noticeShown: string;
    reason: string;
    acknowledgedAt: string;
    acknowledgedByUserId: string;
    acknowledgedMonths: number;
  } | null;
}

/** A retention notice — one row per category the office has set a period for. */
export interface RetentionNotice {
  recordCategory: string;
  retentionPeriodMonths: number;
  /** False means no notice is possible for this category, ever — `unresolvableReason` says why. */
  resolvable: boolean;
  unresolvableReason: string | null;
  elapsedCount: number;
  /** The ids, so an extension can NAME the records it covers. Capped at 500 by the api. */
  elapsedRecordIds: string[];
  heldCount: number;
  extendedCount: number;
  floor: { instrument: string; article: string; operativeText: string } | null;
  countedFrom: string | null;
  noLegalHoldStatement: string;
}

export interface ExtendRetentionInput {
  recordCategory: string;
  recordIds: string[];
  months: number;
  basis: 'LEGISLATIVE_PROVISION' | 'LEGAL_HOLD_OR_DISPUTE' | 'CUSTOMER_EXPLICIT_CONSENT';
  note: string;
  instrument?: string;
  article?: string;
  legalHoldId?: string;
}

export function listRetentionNotices(): Promise<RetentionNotice[]> {
  return apiGet('/retention-notices');
}

export function extendRetention(
  body: ExtendRetentionInput,
): Promise<{ extended: number; extendedUntil: string }> {
  return apiPost('/retention-notices/extend', body);
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
  status: DisposalBatchStatus;
  nominatedByUserId: string;
  managerApprovedAt: string | null;
  dpoApprovedByUserId: string | null;
  /**
   * Set when ONE person both nominated this batch and approved it, in an office that declared COMBINED
   * duty segregation and stated why. Null on every ordinary approval.
   *
   * This pair authorises IRREVERSIBLE DESTRUCTION of personal data, so whether two people agreed is the
   * most load-bearing fact on the row — and the status column says DPO_APPROVED either way.
   */
  combinedDutyAct: CombinedDutyActOnRecord | null;
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
  /** Sent only after the server has asked — the screen holds no copy of the floor list. */
  noFloorDeclaration?: NoFloorDeclarationInput;
}): Promise<RetentionScheduleItem> {
  return apiPost('/retention-schedule', body);
}

export function updateRetentionScheduleItem(
  id: string,
  body: {
    retentionPeriodMonths?: number;
    legalBasis?: string;
    noFloorDeclaration?: NoFloorDeclarationInput;
  },
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

export function dpoApproveDisposalBatch(
id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<DisposalBatch> {
  return apiPost(`/disposal-batches/${id}/dpo-approve`, combinedDutyReason ? { combinedDutyReason } : {});
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
