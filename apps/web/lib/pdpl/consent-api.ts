// M03 — Consent Management (backlog Part D §5.1, Process #52). Reads apps/api's
// /consent-records endpoints: capture a consent decision (grant or explicit
// decline) at a defined touchpoint, and withdraw it through a two-step
// request-withdrawal / confirm-withdrawal flow that gives the
// `consent_withdrawal` SLA timer (2 business days) a real window.
// `consent.manage` (Sales, Placement, Claims, DPO).

import { apiGet, apiPost } from '../auth/api-client';

export const CONSENT_PURPOSES = [
  'UNDERWRITING',
  'CLAIMS',
  'MARKETING',
  'KYC_AML',
  'SHARING_WITH_INSURER',
  'OTHER',
] as const;

export interface ConsentRecord {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  purpose: string;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface RequestWithdrawalResult {
  consentRecordId: string;
  requestedAt: string;
  dueAt: string | null;
}

export function listConsentRecords(
  opts: {
    customerId?: string;
    insuredPersonId?: string;
    purpose?: string;
    granted?: boolean;
  } = {},
): Promise<ConsentRecord[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insuredPersonId) params.set('insuredPersonId', opts.insuredPersonId);
  if (opts.purpose) params.set('purpose', opts.purpose);
  if (opts.granted !== undefined) params.set('granted', String(opts.granted));
  const qs = params.toString();
  return apiGet(`/consent-records${qs ? `?${qs}` : ''}`);
}

export function createConsentRecord(body: {
  customerId?: string;
  insuredPersonId?: string;
  purpose: string;
  granted: boolean;
  consentTextVersion: string;
}): Promise<ConsentRecord> {
  return apiPost('/consent-records', body);
}

export function requestConsentWithdrawal(
  id: string,
): Promise<RequestWithdrawalResult> {
  return apiPost(`/consent-records/${id}/request-withdrawal`, {});
}

export function confirmConsentWithdrawal(id: string): Promise<ConsentRecord> {
  return apiPost(`/consent-records/${id}/confirm-withdrawal`, {});
}
