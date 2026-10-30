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

/**
 * `ConsentRecord.purpose` is a Prisma ENUM with exactly these six members, and this
 * interface declared it `string` — the hand-copied-interface class in its quiet form:
 * not a missing field, a WIDENED TYPE. The wire value was always one of six.
 *
 * Declaring the union is what lets `/consent` index `ENUM_LABEL.ConsentPurpose`
 * totally, so a seventh member is a compile error at the one place that would
 * otherwise render `undefined`. A cast would have silenced the compiler and kept the
 * hole; decision 49's declared fallback would have been wrong too, because that is for
 * a vocabulary which is genuinely OPEN and this one is closed by the database.
 */
export type ConsentPurpose =
  | 'UNDERWRITING'
  | 'CLAIMS'
  | 'MARKETING'
  | 'KYC_AML'
  | 'SHARING_WITH_INSURER'
  | 'OTHER';

export interface ConsentRecord {
  id: string;
  customerId: string | null;
  insuredPersonId: string | null;
  leadId: string | null;
  purpose: ConsentPurpose;
  isMarketing: boolean;
  granted: boolean;
  consentTextVersion: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  isActive: boolean;
  createdAt: string;
  /** Batch six item 2 — whichever subject this record names, BY NAME. The KIND is not on the
   *  wire: the three ids are already here, so the screen can see which one is set. */
  subjectName: string | null;
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
    leadId?: string;
    /* Left LOOSE on purpose: this is a querystring filter, and the server validates
     * it. Narrowing it would be tightening the one place where a caller legitimately
     * passes whatever the user typed. */
    purpose?: string;
    granted?: boolean;
  } = {},
): Promise<ConsentRecord[]> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.insuredPersonId) params.set('insuredPersonId', opts.insuredPersonId);
  if (opts.leadId) params.set('leadId', opts.leadId);
  if (opts.purpose) params.set('purpose', opts.purpose);
  if (opts.granted !== undefined) params.set('granted', String(opts.granted));
  const qs = params.toString();
  return apiGet(`/consent-records${qs ? `?${qs}` : ''}`);
}

export function createConsentRecord(body: {
  customerId?: string;
  insuredPersonId?: string;
  leadId?: string;
  purpose: ConsentPurpose;
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
