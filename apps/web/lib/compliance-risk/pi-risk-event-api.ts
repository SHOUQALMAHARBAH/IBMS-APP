// Process 54 — the broker's own PI risk events (backlog Part C #53-54's
// shared header). A Policy Checking discrepancy (Process 20) already
// auto-logs one; this also supports a manual log for an exposure that did
// not come through that path. Reads/writes apps/api's /pi-risk-events
// endpoints. pi-policy.manage (Compliance).

import { apiGet, apiPost } from '../auth/api-client';

export interface PiRiskEvent {
  id: string;
  piPolicyId: string | null;
  sourcePolicyCheckingId: string | null;
  description: string;
  mitigationAction: string | null;
  loggedAt: string;
  isAutoLogged: boolean;
}

export function listPiRiskEvents(
  opts: { piPolicyId?: string; sourcePolicyCheckingId?: string } = {},
): Promise<PiRiskEvent[]> {
  const params = new URLSearchParams();
  if (opts.piPolicyId) params.set('piPolicyId', opts.piPolicyId);
  if (opts.sourcePolicyCheckingId) {
    params.set('sourcePolicyCheckingId', opts.sourcePolicyCheckingId);
  }
  const qs = params.toString();
  return apiGet(`/pi-risk-events${qs ? `?${qs}` : ''}`);
}

export function logPiRiskEvent(body: {
  description: string;
  piPolicyId?: string;
}): Promise<PiRiskEvent> {
  return apiPost('/pi-risk-events', body);
}

export function recordPiRiskEventMitigation(
  id: string,
  mitigationAction: string,
): Promise<PiRiskEvent> {
  return apiPost(`/pi-risk-events/${id}/mitigation`, { mitigationAction });
}
