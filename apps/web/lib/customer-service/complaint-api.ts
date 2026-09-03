// Process 42 — Complaints Management (backlog Part C #42, Domain E). Reads
// apps/api's /complaints endpoints: log a customer complaint (optionally
// against a disputed claim), assign / work / resolve it, escalate it to the
// Insurance Dispute Resolution Committee, and close it with a mandatory
// supervisor sign-off (a different user than the resolver).
//   - complaint.log      (Sales, Claims, Finance, Compliance, Manager)
//   - complaint.escalate (Manager, Compliance)
//   - complaint.close     (Manager)

import { apiGet, apiPost } from '../auth/api-client';

export interface ComplaintSla {
  timerId: string;
  dueAt: string;
  escalatedAt: string | null;
  escalatedTo: string | null;
  resolvedAt: string | null;
  breached: boolean;
}

export interface ComplaintAction {
  id: string;
  actionText: string;
  takenByUserId: string;
  takenAt: string;
}

export interface ComplaintEscalation {
  id: string;
  escalatedTo: string;
  escalatedByUserId: string | null;
  reason: string | null;
  escalatedAt: string;
}

export interface Complaint {
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
  closureApprovedByUserId: string | null;
  closedAt: string | null;
  sla: ComplaintSla | null;
  actions: ComplaintAction[];
  escalations: ComplaintEscalation[];
  createdAt: string;
}

export const COMPLAINT_CATEGORIES = [
  'denied_claim',
  'delayed_issuance',
  'premium_dispute',
  'unanswered_claim',
  'other',
];

export function listComplaints(
  opts: {
    customerId?: string;
    status?: string;
    claimId?: string;
    responsibleEmployeeUserId?: string;
  } = {},
): Promise<Complaint[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.status) params.set('status', opts.status);
  if (opts.claimId) params.set('claimId', opts.claimId);
  if (opts.responsibleEmployeeUserId)
    params.set('responsibleEmployeeUserId', opts.responsibleEmployeeUserId);
  const qs = params.toString();
  return apiGet(`/complaints${qs ? `?${qs}` : ''}`);
}

export function createComplaint(body: {
  customerId: string;
  issue: string;
  category?: string;
  claimId?: string;
  policyId?: string;
  responsibleEmployeeUserId?: string;
}): Promise<Complaint> {
  return apiPost('/complaints', body);
}

export function assignComplaint(
  id: string,
  responsibleEmployeeUserId: string,
): Promise<Complaint> {
  return apiPost(`/complaints/${id}/assign`, { responsibleEmployeeUserId });
}

export function startComplaint(id: string): Promise<Complaint> {
  return apiPost(`/complaints/${id}/start`, {});
}

export function addComplaintAction(
  id: string,
  actionText: string,
): Promise<Complaint> {
  return apiPost(`/complaints/${id}/actions`, { actionText });
}

export function resolveComplaint(
  id: string,
  resolution: string,
): Promise<Complaint> {
  return apiPost(`/complaints/${id}/resolve`, { resolution });
}

export function escalateComplaint(
  id: string,
  body: { escalatedTo?: string; reason?: string } = {},
): Promise<Complaint> {
  return apiPost(`/complaints/${id}/escalate`, body);
}

export function closeComplaint(id: string): Promise<Complaint> {
  return apiPost(`/complaints/${id}/close`, {});
}
