// M04 — Data Subject Request Management (backlog Part D, bundled under
// Process #52 "Data Protection Compliance"). Reads/writes apps/api's /dsr
// endpoints. dsr.log (broad) gates create+read; dsr.handle (DPO-only) gates
// every working action; dsr.close (DPO-only) gates the mandatory-sign-off
// closure.

import { apiGet, apiPost } from '../auth/api-client';

export const DSR_TYPES = ['ACCESS', 'CORRECTION', 'DELETION', 'OBJECTION'] as const;

export type DsrType = 'ACCESS' | 'CORRECTION' | 'DELETION' | 'OBJECTION';

export type DsrStatus =
  | 'RECEIVED'
  | 'IDENTITY_VERIFIED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'REJECTED'
  | 'CLOSED';

export interface DataSubjectRequest {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  type: DsrType;
  status: DsrStatus;
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

  /** THE REQUEST'S OWN CLOCK, on the single-request read only.
   *
   * A request carries SEVERAL timers — two escalation stages, and a second pair once an
   * extension re-bases the deadline — so these are counts rather than a boolean: "two of
   * four paused" is a real state and a boolean would be wrong about the rest. Absent on
   * the LIST read deliberately, because populating it there is one timer query per row
   * for a figure no list shows; a caller without it must treat the clock as unknown
   * rather than as running. */
  slaClock?: {
    open: number;
    paused: number;
    pauseReason: string | null;
    pausedAt: string | null;
  };
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

export function closeDsr(
id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<DataSubjectRequest> {
  return apiPost(`/dsr/${id}/close`, combinedDutyReason ? { combinedDutyReason } : {});
}

/*
 * STOPPING AND RESTARTING ONE REQUEST'S STATUTORY CLOCK.
 *
 * The control lives on the REQUEST and not on the deadlines dashboard, by the owner's
 * decision (IMPROVEMENTS § 1.61). The Data Protection Officer holds `sla.timer.pause` and
 * NOT `sla-dashboard.view`, so for the one role whose own statutory clocks are the
 * likeliest thing anybody would legitimately pause, the capability was unreachable — and
 * granting that role the whole office's deadlines dashboard would widen what it sees to
 * save a line of code. The pause happens for one request, for one stated cause, so it
 * belongs where that request is.
 *
 * Gated on `sla.timer.pause`, not on `dsr.handle`: stopping a compliance clock is the
 * same act here as anywhere else and needs the same permission.
 */

/** The single-request read — the only one that carries `slaClock`. Fetched when the
 * pause control opens rather than for every row of the list. */
export function getDsr(id: string): Promise<DataSubjectRequest> {
  return apiGet(`/dsr/${encodeURIComponent(id)}`);
}

/** Stops EVERY open clock on the request, for one reason. The server covers all of them
 * because pausing one of four looks exactly like a control that worked while the request
 * still escalates. */
export function pauseDsrSla(
  id: string,
  reason: string,
): Promise<{ paused: number; alreadyPaused: number; open: number }> {
  return apiPost(`/dsr/${encodeURIComponent(id)}/sla/pause`, {
    reason: reason.trim(),
  });
}

export function resumeDsrSla(
  id: string,
): Promise<{ resumed: number; notPaused: number }> {
  return apiPost(`/dsr/${encodeURIComponent(id)}/sla/resume`, {});
}

/** The floor `PauseSlaTimerDto` enforces, mirrored so the screen does not send a request
 * it already knows will be refused. The server stays the authority. */
export const DSR_PAUSE_REASON_MIN_LENGTH = 10;

export function dsrPauseReasonIsValid(reason: string): boolean {
  return reason.trim().length >= DSR_PAUSE_REASON_MIN_LENGTH;
}
