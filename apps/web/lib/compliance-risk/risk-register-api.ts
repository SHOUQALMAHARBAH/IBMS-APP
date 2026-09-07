// Process 53 — the broker's own operational/cyber/financial/compliance/
// reputational risk register (backlog Part C #53-54's first checkbox).
// Reads/writes apps/api's /risk-register endpoints. risk-register.manage
// (Compliance or Branch/Department Manager).

import { apiGet, apiPost } from '../auth/api-client';

export const RISK_REGISTER_TYPES = [
  'operational',
  'cyber',
  'financial',
  'compliance',
  'reputational',
];

export interface RiskRegisterItem {
  id: string;
  riskType: string;
  description: string;
  mitigationAction: string | null;
  status: string;
  loggedAt: string;
  closedAt: string | null;
}

export function listRiskRegisterItems(
  opts: { riskType?: string; status?: string } = {},
): Promise<RiskRegisterItem[]> {
  const params = new URLSearchParams();
  if (opts.riskType) params.set('riskType', opts.riskType);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  return apiGet(`/risk-register${qs ? `?${qs}` : ''}`);
}

export function createRiskRegisterItem(body: {
  riskType: string;
  description: string;
  mitigationAction?: string;
}): Promise<RiskRegisterItem> {
  return apiPost('/risk-register', body);
}

export function recordRiskRegisterMitigation(
  id: string,
  mitigationAction: string,
): Promise<RiskRegisterItem> {
  return apiPost(`/risk-register/${id}/mitigation`, { mitigationAction });
}

export function closeRiskRegisterItem(id: string): Promise<RiskRegisterItem> {
  return apiPost(`/risk-register/${id}/close`, {});
}
