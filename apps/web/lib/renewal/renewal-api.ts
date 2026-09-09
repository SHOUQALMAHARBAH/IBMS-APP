import { apiGet, apiPatch, apiPost } from '../auth/api-client';

// Part 3.9 — Renewal Management. A RenewalCase opens automatically at the
// configurable lead time before a policy expires (nightly sweep + on demand),
// then walks RenewalStatus through the workflow engine.

export type RenewalStatus =
  | 'RENEWAL_DUE'
  | 'IN_PROGRESS'
  | 'QUOTES_OBTAINED'
  | 'RECOMMENDED'
  | 'CLIENT_DECISION'
  | 'RENEWED'
  | 'LAPSED'
  | 'CANCELLED';

/** The moves the API will accept from each status — mirrors
 * `WORKFLOW_TRANSITIONS.RenewalCase` so the UI only offers legal ones. The
 * server is still the authority; this just avoids offering a guaranteed 422. */
export const RENEWAL_NEXT_STATUSES: Record<RenewalStatus, RenewalStatus[]> = {
  RENEWAL_DUE: ['IN_PROGRESS', 'LAPSED'],
  IN_PROGRESS: ['QUOTES_OBTAINED', 'LAPSED'],
  QUOTES_OBTAINED: ['RECOMMENDED', 'LAPSED'],
  RECOMMENDED: ['CLIENT_DECISION', 'LAPSED'],
  CLIENT_DECISION: ['RENEWED', 'LAPSED', 'CANCELLED'],
  RENEWED: [],
  LAPSED: [],
  CANCELLED: [],
};

export interface RenewalCase {
  id: string;
  policyId: string;
  customerId: string;
  customerLegalName: string;
  policyNumber: string | null;
  insuranceLine: string;
  insurerId: string;
  policyStatus: string;
  inceptionDate: string | null;
  expiryDate: string | null;
  status: RenewalStatus;
  leadTimeDays: number;
  triggeredAt: string;
  riskChangedSinceLastRenewal: boolean;
  insurerTermsWorsened: boolean;
  retentionEscalatedAt: string | null;
  open: boolean;
  requiresRemarketing: boolean;
  lossRatio: {
    periodClaims: string;
    periodPremium: string;
    ratio: string;
  } | null;
}

export interface RenewalSweepResult {
  scanned: number;
  opened: number;
  skippedAlreadyOpen: number;
  failed: number;
}

export function listRenewalCases(params?: {
  customerId?: string;
  policyId?: string;
}): Promise<RenewalCase[]> {
  const qs = new URLSearchParams();
  if (params?.customerId) qs.set('customerId', params.customerId);
  if (params?.policyId) qs.set('policyId', params.policyId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/renewal-cases${suffix}`);
}

export function getRenewalCase(id: string): Promise<RenewalCase> {
  return apiGet(`/renewal-cases/${encodeURIComponent(id)}`);
}

/** Open a case for every ACTIVE policy inside the lead-time window that has
 * none. The nightly scheduler runs the same sweep. */
export function runRenewalSweep(): Promise<RenewalSweepResult> {
  return apiPost('/renewal-cases/detect');
}

export function transitionRenewalCase(
  id: string,
  toStatus: RenewalStatus,
): Promise<RenewalCase> {
  return apiPost(`/renewal-cases/${encodeURIComponent(id)}/transition`, {
    toStatus,
  });
}

/** The two re-marketing triggers: a materially changed risk needs a fresh
 * Risk Assessment, worsened insurer terms need full re-marketing. */
export function setRenewalFlags(
  id: string,
  flags: {
    riskChangedSinceLastRenewal?: boolean;
    insurerTermsWorsened?: boolean;
  },
): Promise<RenewalCase> {
  return apiPatch(`/renewal-cases/${encodeURIComponent(id)}/flags`, flags);
}
