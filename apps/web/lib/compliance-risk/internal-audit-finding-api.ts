// Process 57 — the internal audit findings and remediation tracker
// (backlog Part C #57's first checkbox). Reads/writes apps/api's
// /internal-audit-findings endpoints. internal-audit.record (Compliance)
// gates recording/updating; internal-audit.close (Compliance or Manager)
// gates closure.

import { apiGet, apiPost } from '../auth/api-client';

export interface InternalAuditFinding {
  id: string;
  auditPeriodLabel: string;
  finding: string;
  remediationAction: string | null;
  status: string;
  loggedAt: string;
  closedAt: string | null;
}

export function listInternalAuditFindings(
  opts: { status?: string } = {},
): Promise<InternalAuditFinding[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/internal-audit-findings${qs ? `?${qs}` : ''}`);
}

export function createInternalAuditFinding(body: {
  auditPeriodLabel: string;
  finding: string;
  remediationAction?: string;
}): Promise<InternalAuditFinding> {
  return apiPost('/internal-audit-findings', body);
}

export function recordInternalAuditFindingRemediation(
  id: string,
  remediationAction: string,
): Promise<InternalAuditFinding> {
  return apiPost(`/internal-audit-findings/${id}/remediation`, {
    remediationAction,
  });
}

export function closeInternalAuditFinding(
  id: string,
): Promise<InternalAuditFinding> {
  return apiPost(`/internal-audit-findings/${id}/close`, {});
}
