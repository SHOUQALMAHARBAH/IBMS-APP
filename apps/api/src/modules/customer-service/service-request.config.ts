import { Prisma } from '@ibms/db';

/**
 * Process 41 — Customer Requests (backlog Part C #41, Domain E). The pure,
 * deterministic core: the `requestType` / `status` domains, the legal status
 * moves, and the view / audit-snapshot shapes.
 *
 * `ServiceRequest.status` is a PLAIN STRING — NOT a `WorkflowTransitionService`
 * entity (the `CommissionLedgerEntry.status` / `ReconciliationException.status`
 * pattern). The legal moves live in `SERVICE_REQUEST_TRANSITIONS` and every
 * move is validated against it + persisted via a status-conditional
 * `updateMany` (`ibms-brain/meta/lex/race-safe-invariants.md`).
 *
 * `ibms-brain/meta/context/customer-service-lifecycle.md` § "Customer Requests
 * (Process 41)".
 */

export const SERVICE_REQUEST_TYPES = [
  'certificate',
  'copy',
  'change',
  'other',
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const SERVICE_REQUEST_STATUSES = [
  'open',
  'in_progress',
  'fulfilled',
  'cancelled',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** Legal `ServiceRequest.status` moves. `open` may go straight to a terminal
 * state (a request fulfilled on the spot); `fulfilled` / `cancelled` are
 * terminal. */
export const SERVICE_REQUEST_TRANSITIONS: Record<
  ServiceRequestStatus,
  readonly ServiceRequestStatus[]
> = {
  open: ['in_progress', 'fulfilled', 'cancelled'],
  in_progress: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

export function isServiceRequestTransition(
  from: string,
  to: ServiceRequestStatus,
): boolean {
  const allowed = SERVICE_REQUEST_TRANSITIONS[from as ServiceRequestStatus];
  return allowed !== undefined && allowed.includes(to);
}

export function isTerminalServiceRequestStatus(status: string): boolean {
  return status === 'fulfilled' || status === 'cancelled';
}

/** The `SLA_REGISTRY` workflow this request's fulfilment deadline is tracked
 * under (a DRAFTED 5-business-day default — see `sla-registry.config.ts`). */
export const SERVICE_REQUEST_SLA_WORKFLOW = 'service_request_fulfilment';

/**
 * `detail` / `outcomeNote` are free-text business notes returned unmasked in
 * every list row and stored verbatim in the audit `afterValue` — Confidential
 * tier, not Highly Confidential. This guard keeps a full bank account / card
 * number (Highly Confidential — `sensitive-data-handling.md`) out of them: a
 * run of 9+ consecutive digits is rejected. A payment-method change is
 * recorded through an approved `PaymentChannel` (Process 38, masked
 * `accountLast4` only), not typed into `detail`. `[\s\S]*` (not `.*`) so a
 * multi-line note still matches. */
export const NO_FULL_ACCOUNT_NUMBER = /^(?!.*\d{9,})[\s\S]*$/;
export const NO_FULL_ACCOUNT_NUMBER_MESSAGE =
  'must not contain a run of 9+ digits — record a payment-method / account change through an approved payment channel (Process 38), not free text';

/** Cap on a book-wide `ServiceRequest` list. */
export const SERVICE_REQUEST_READ_LIMIT = 5000;

export interface ServiceRequestSlaTimerRow {
  id: string;
  dueAt: Date;
  escalatedAt: Date | null;
  escalatedTo: string | null;
  resolvedAt: Date | null;
}

export interface ServiceRequestRow {
  id: string;
  customerId: string;
  policyId: string | null;
  requestType: string;
  detail: string | null;
  status: string;
  slaTimerId: string | null;
  slaTimer: ServiceRequestSlaTimerRow | null;
  raisedByUserId: string | null;
  assignedToUserId: string | null;
  fulfilledByUserId: string | null;
  outcomeNote: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

export interface ServiceRequestSlaView {
  timerId: string;
  dueAt: string;
  escalatedAt: string | null;
  escalatedTo: string | null;
  resolvedAt: string | null;
  /** Overdue AND not yet resolved as at `now` (the sweep may not have run). */
  breached: boolean;
}

export interface ServiceRequestView {
  id: string;
  customerId: string;
  policyId: string | null;
  requestType: string;
  detail: string | null;
  status: string;
  isClosed: boolean;
  raisedByUserId: string | null;
  assignedToUserId: string | null;
  fulfilledByUserId: string | null;
  outcomeNote: string | null;
  sla: ServiceRequestSlaView | null;
  createdAt: string;
  closedAt: string | null;
}

export function deriveServiceRequestView(
  row: ServiceRequestRow,
  now: Date = new Date(),
): ServiceRequestView {
  return {
    id: row.id,
    customerId: row.customerId,
    policyId: row.policyId,
    requestType: row.requestType,
    detail: row.detail,
    status: row.status,
    isClosed: isTerminalServiceRequestStatus(row.status),
    raisedByUserId: row.raisedByUserId,
    assignedToUserId: row.assignedToUserId,
    fulfilledByUserId: row.fulfilledByUserId,
    outcomeNote: row.outcomeNote,
    sla: row.slaTimer
      ? {
          timerId: row.slaTimer.id,
          dueAt: row.slaTimer.dueAt.toISOString(),
          escalatedAt: row.slaTimer.escalatedAt
            ? row.slaTimer.escalatedAt.toISOString()
            : null,
          escalatedTo: row.slaTimer.escalatedTo,
          resolvedAt: row.slaTimer.resolvedAt
            ? row.slaTimer.resolvedAt.toISOString()
            : null,
          breached:
            row.slaTimer.resolvedAt === null &&
            row.slaTimer.dueAt.getTime() <= now.getTime(),
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
  };
}

/** CREATE audit `afterValue` — ids + type + status, no free text beyond the
 * request `detail` (a business description, not personal data by policy). */
export function serviceRequestAuditSnapshot(input: {
  serviceRequestId: string;
  customerId: string;
  policyId: string | null;
  requestType: string;
  detail: string | null;
  status: string;
  assignedToUserId: string | null;
}): Prisma.InputJsonObject {
  return {
    serviceRequestId: input.serviceRequestId,
    customerId: input.customerId,
    policyId: input.policyId,
    requestType: input.requestType,
    detail: input.detail,
    status: input.status,
    assignedToUserId: input.assignedToUserId,
  };
}

/** UPDATE audit `afterValue` — the new status + who + the closure note
 * (verbatim on fulfil / cancel; a business justification, not personal data). */
export function serviceRequestUpdateAuditSnapshot(input: {
  serviceRequestId: string;
  customerId: string;
  status: string;
  assignedToUserId: string | null;
  fulfilledByUserId: string | null;
  outcomeNote: string | null;
  closedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    serviceRequestId: input.serviceRequestId,
    customerId: input.customerId,
    status: input.status,
    assignedToUserId: input.assignedToUserId,
    fulfilledByUserId: input.fulfilledByUserId,
    outcomeNote: input.outcomeNote,
    closedAt: input.closedAt ? input.closedAt.toISOString() : null,
  };
}
