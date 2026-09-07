import { Prisma } from '@ibms/db';

/**
 * Process 42 — Complaints Management (backlog Part C #42, Domain E). The pure,
 * deterministic core: the `category` / `escalatedTo` domains, the SLA workflow
 * name, and the view / audit-snapshot shapes.
 *
 * `Complaint.status` IS a `WorkflowTransitionService` entity (unlike Process
 * 41's plain-string `ServiceRequest`) — `WORKFLOW_TRANSITIONS.Complaint` owns
 * the legal moves; every move goes through `WorkflowTransitionService.transition`.
 *
 * `ibms-brain/meta/context/customer-service-lifecycle.md` § "Complaints
 * Management (Process 42)".
 */

/** `Complaint.category` — the schema comment's controlled list. Optional on a
 * complaint (triage may not classify it immediately). */
export const COMPLAINT_CATEGORIES = [
  'denied_claim',
  'delayed_issuance',
  'premium_dispute',
  'unanswered_claim',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** `EscalationRecord.escalatedTo` — where an internally-unresolved complaint
 * goes. `dispute_resolution_committee` (the CBJ Insurance Dispute Resolution
 * Committee) is the backlog line's named target and the default. */
export const COMPLAINT_ESCALATION_TARGETS = [
  'management',
  'regulator',
  'dispute_resolution_committee',
] as const;
export type ComplaintEscalationTarget =
  (typeof COMPLAINT_ESCALATION_TARGETS)[number];

export const DEFAULT_ESCALATION_TARGET: ComplaintEscalationTarget =
  'dispute_resolution_committee';

/** The `ComplaintStatus` enum values, as strings, for query validation. */
export const COMPLAINT_STATUSES = [
  'LOGGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'ESCALATED',
] as const;

/** Only `CLOSED` is terminal — `RESOLVED` is "awaiting supervisor sign-off". */
export function isTerminalComplaintStatus(status: string): boolean {
  return status === 'CLOSED';
}

/** The `SLA_REGISTRY` workflow this complaint's resolution deadline is tracked
 * under (a DRAFTED 10-business-day default — see `sla-registry.config.ts`). */
export const COMPLAINT_SLA_WORKFLOW = 'complaint_resolution';

/** Cap on a book-wide `Complaint` list. */
export const COMPLAINT_READ_LIMIT = 5000;

export interface ComplaintSlaTimerRow {
  id: string;
  dueAt: Date;
  escalatedAt: Date | null;
  escalatedTo: string | null;
  resolvedAt: Date | null;
}

export interface ComplaintActionRow {
  id: string;
  actionText: string;
  takenByUserId: string;
  takenAt: Date;
}

export interface EscalationRecordRow {
  id: string;
  escalatedTo: string;
  escalatedByUserId: string | null;
  reason: string | null;
  escalatedAt: Date;
}

export interface ComplaintRow {
  id: string;
  customerId: string;
  claimId: string | null;
  policyId: string | null;
  issue: string;
  category: string | null;
  status: string;
  slaTimerId: string | null;
  slaTimer: ComplaintSlaTimerRow | null;
  responsibleEmployeeUserId: string | null;
  resolution: string | null;
  resolvedByUserId: string | null;
  resolvedAt: Date | null;
  closureApprovedByUserId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  actions: ComplaintActionRow[];
  escalations: EscalationRecordRow[];
}

export interface ComplaintSlaView {
  timerId: string;
  dueAt: string;
  escalatedAt: string | null;
  escalatedTo: string | null;
  resolvedAt: string | null;
  /** Overdue AND not yet resolved as at `now` (the sweep may not have run). */
  breached: boolean;
}

export interface ComplaintView {
  id: string;
  customerId: string;
  claimId: string | null;
  policyId: string | null;
  issue: string;
  category: string | null;
  status: string;
  isClosed: boolean;
  responsibleEmployeeUserId: string | null;
  resolution: string | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  closureApprovedByUserId: string | null;
  closedAt: string | null;
  sla: ComplaintSlaView | null;
  actions: Array<{
    id: string;
    actionText: string;
    takenByUserId: string;
    takenAt: string;
  }>;
  escalations: Array<{
    id: string;
    escalatedTo: string;
    escalatedByUserId: string | null;
    reason: string | null;
    escalatedAt: string;
  }>;
  createdAt: string;
}

export function deriveComplaintView(
  row: ComplaintRow,
  now: Date = new Date(),
): ComplaintView {
  return {
    id: row.id,
    customerId: row.customerId,
    claimId: row.claimId,
    policyId: row.policyId,
    issue: row.issue,
    category: row.category,
    status: row.status,
    isClosed: isTerminalComplaintStatus(row.status),
    responsibleEmployeeUserId: row.responsibleEmployeeUserId,
    resolution: row.resolution,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    closureApprovedByUserId: row.closureApprovedByUserId,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
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
    actions: [...row.actions]
      .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
      .map((a) => ({
        id: a.id,
        actionText: a.actionText,
        takenByUserId: a.takenByUserId,
        takenAt: a.takenAt.toISOString(),
      })),
    escalations: [...row.escalations]
      .sort((a, b) => a.escalatedAt.getTime() - b.escalatedAt.getTime())
      .map((e) => ({
        id: e.id,
        escalatedTo: e.escalatedTo,
        escalatedByUserId: e.escalatedByUserId,
        reason: e.reason,
        escalatedAt: e.escalatedAt.toISOString(),
      })),
    createdAt: row.createdAt.toISOString(),
  };
}

/** CREATE audit `afterValue` — ids + issue + category + status. `issue` is a
 * Confidential business note (not personal data by policy), carried verbatim. */
export function complaintAuditSnapshot(input: {
  complaintId: string;
  customerId: string;
  claimId: string | null;
  policyId: string | null;
  issue: string;
  category: string | null;
  status: string;
  responsibleEmployeeUserId: string | null;
}): Prisma.InputJsonObject {
  return {
    complaintId: input.complaintId,
    customerId: input.customerId,
    claimId: input.claimId,
    policyId: input.policyId,
    issue: input.issue,
    category: input.category,
    status: input.status,
    responsibleEmployeeUserId: input.responsibleEmployeeUserId,
  };
}

/** UPDATE audit `afterValue` — the new status + who + the verbatim
 * resolution / closure trail. */
export function complaintUpdateAuditSnapshot(input: {
  complaintId: string;
  customerId: string;
  status: string;
  responsibleEmployeeUserId: string | null;
  resolution: string | null;
  resolvedByUserId: string | null;
  closureApprovedByUserId: string | null;
  closedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    complaintId: input.complaintId,
    customerId: input.customerId,
    status: input.status,
    responsibleEmployeeUserId: input.responsibleEmployeeUserId,
    resolution: input.resolution,
    resolvedByUserId: input.resolvedByUserId,
    closureApprovedByUserId: input.closureApprovedByUserId,
    closedAt: input.closedAt ? input.closedAt.toISOString() : null,
  };
}

/** CREATE audit `afterValue` for a `ComplaintAction` — the verbatim action
 * text + who. */
export function complaintActionAuditSnapshot(input: {
  complaintActionId: string;
  complaintId: string;
  actionText: string;
  takenByUserId: string;
}): Prisma.InputJsonObject {
  return {
    complaintActionId: input.complaintActionId,
    complaintId: input.complaintId,
    actionText: input.actionText,
    takenByUserId: input.takenByUserId,
  };
}

/** CREATE audit `afterValue` for an `EscalationRecord`. */
export function escalationAuditSnapshot(input: {
  escalationRecordId: string;
  complaintId: string;
  escalatedTo: string;
  escalatedByUserId: string | null;
  reason: string | null;
}): Prisma.InputJsonObject {
  return {
    escalationRecordId: input.escalationRecordId,
    complaintId: input.complaintId,
    escalatedTo: input.escalatedTo,
    escalatedByUserId: input.escalatedByUserId,
    reason: input.reason,
  };
}
