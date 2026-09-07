// Process 55/Part 6.2/Part 7.4 — Incident Management (backlog Part C #55).
// Reads/writes apps/api's /incidents endpoints. incident.report (broad)
// gates create+read; incident.contain (Admin/Compliance) gates the
// operational response; incident.classify (DPO + Executive Management)
// gates classify/co-sign/notify-senior-management; incident.notify-regulator
// (DPO/Compliance) gates the external filings.

import { apiGet, apiPost } from '../auth/api-client';

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const INCIDENT_REGULATORS = [
  'CBJ',
  'NCSC',
  'Personal_Data_Protection_Council',
];

export interface IncidentReport {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  reportedAt: string;
  containedAt: string | null;
  impactAssessedAt: string | null;
  classification: string;
  classifiedByDpoUserId: string | null;
  seniorManagementCoSignUserId: string | null;
  seniorManagementNotifiedAt: string | null;
  notifiedRegulators: string[];
  notifiedAt: string | null;
  affectedDataSubjectsNotifiedAt: string | null;
  rootCauseAnalysis: string | null;
  recoveredAt: string | null;
  closedAt: string | null;
  isContainmentOverdue: boolean;
}

export function listIncidents(
  opts: { status?: string; severity?: string; classification?: string } = {},
): Promise<IncidentReport[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.severity) params.set('severity', opts.severity);
  if (opts.classification) params.set('classification', opts.classification);
  const qs = params.toString();
  return apiGet(`/incidents${qs ? `?${qs}` : ''}`);
}

export function createIncident(body: {
  title: string;
  description: string;
  severity: string;
}): Promise<IncidentReport> {
  return apiPost('/incidents', body);
}

export function containIncident(id: string): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/contain`, {});
}

export function assessIncidentImpact(id: string): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/assess-impact`, {});
}

export function classifyIncident(
  id: string,
  classification: 'MATERIAL' | 'NON_MATERIAL',
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/classify`, { classification });
}

export function coSignIncident(id: string): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/co-sign`, {});
}

export function notifyIncidentSeniorManagement(
  id: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-senior-management`, {});
}

export function notifyIncidentRegulators(
  id: string,
  regulators: string[],
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-regulators`, { regulators });
}

export function notifyIncidentAffectedSubjects(
  id: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/notify-affected-subjects`, {});
}

export function recoverIncident(id: string): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/recover`, {});
}

export function closeIncident(
  id: string,
  rootCauseAnalysis: string,
): Promise<IncidentReport> {
  return apiPost(`/incidents/${id}/close`, { rootCauseAnalysis });
}
