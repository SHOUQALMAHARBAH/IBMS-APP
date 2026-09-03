// Process 35 — Commission Calculation (backlog Part C #35, Domain D). Reads
// apps/api's /commission endpoints: the governed CommissionAgreement rate table
// (by insurer + line) and the CommissionLedgerEntry ledger — apply the governed
// rate (commission.calculate), raise a manual override with a mandatory reason
// (commission-override.raise), and the separate approval
// (commission-override.approve).

import { apiGet, apiPost } from '../auth/api-client';

export interface CommissionAgreement {
  id: string;
  insurerId: string;
  insurerName: string;
  insuranceLine: string;
  ratePercent: string;
  vatRatePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOpen: boolean;
}

export interface CommissionEntry {
  id: string;
  policyId: string;
  commissionAgreementId: string | null;
  amount: string;
  vatRatePercent: string;
  vatAmount: string;
  grossAmount: string;
  overrideAmount: string | null;
  effectiveAmount: string;
  status: string;
  isManualOverride: boolean;
  overrideReason: string | null;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  overridePending: boolean;
  paidAmount: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  reversedAmount: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export interface Insurer {
  id: string;
  name: string;
}

export function listCommissionAgreements(
  opts: { insurerId?: string; insuranceLine?: string } = {},
): Promise<CommissionAgreement[]> {
  const params = new URLSearchParams();
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.insuranceLine) params.set('insuranceLine', opts.insuranceLine);
  const qs = params.toString();
  return apiGet(`/commission/agreements${qs ? `?${qs}` : ''}`);
}

export function listCommissionInsurers(): Promise<Insurer[]> {
  return apiGet('/commission/insurers');
}

export function createCommissionAgreement(body: {
  insurerId: string;
  insuranceLine: string;
  ratePercent: string;
  vatRatePercent?: string;
  effectiveFrom?: string;
}): Promise<CommissionAgreement> {
  return apiPost('/commission/agreements', body);
}

export function listCommissionEntriesForPolicy(
  policyId: string,
): Promise<CommissionEntry[]> {
  return apiGet(`/commission/entries?policyId=${encodeURIComponent(policyId)}`);
}

export function calculateCommission(policyId: string): Promise<CommissionEntry> {
  return apiPost('/commission/entries', { policyId });
}

export function raiseCommissionOverride(
  entryId: string,
  body: { overrideAmount: string; reason: string },
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/override`, body);
}

export function approveCommissionOverride(
  entryId: string,
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/override/approve`, {});
}

/** Process 36 — reconcile the entry against an insurer statement and mark it
 * paid (`commission.reconcile` / Finance). */
export function settleCommission(
  entryId: string,
  body: { statementAmount: string; paymentReference: string },
): Promise<CommissionEntry> {
  return apiPost(`/commission/entries/${entryId}/settle`, body);
}
