// Process 22 — Endorsement Management (backlog Part C #22, Domain B). Talks to
// apps/api's endorsement module (endorsement.controller.ts): raise a
// positive/negative mid-term endorsement or a cancellation on an ACTIVE
// policy, walk it to the insurer, calculate the premium adjustment (which
// auto-creates the tied commission reversal + a maker/checker refund for a
// return premium), apply it (opening a NEW coverage-schedule version), and
// notify the client.

import { apiGet, apiPost } from '../auth/api-client';

export type EndorsementStatus =
  | 'REQUESTED'
  | 'SUBMITTED_TO_INSURER'
  | 'INSURER_CONFIRMED'
  | 'FINANCIAL_ADJUSTMENT_CALCULATED'
  | 'REFUND_APPROVAL_PENDING'
  | 'APPLIED'
  | 'CLIENT_NOTIFIED';

export const ENDORSEMENT_CHANGE_TYPE_OPTIONS = [
  'add_vehicle',
  'remove_vehicle',
  'add_employee',
  'remove_employee',
  'address_change',
  'sum_insured_increase',
  'add_location',
  'change_beneficiary',
  'coverage_amendment',
] as const;
export type EndorsementChangeType =
  (typeof ENDORSEMENT_CHANGE_TYPE_OPTIONS)[number];

export const CANCELLATION_BASIS_OPTIONS = [
  { value: 'pro_rata', label: 'Pro-rata' },
  { value: 'short_period', label: 'Short-period' },
] as const;
export type CancellationBasis =
  (typeof CANCELLATION_BASIS_OPTIONS)[number]['value'];

export interface Endorsement {
  id: string;
  policyId: string;
  customerId: string;
  type: 'POSITIVE' | 'NEGATIVE';
  changeType: string;
  status: EndorsementStatus;
  premiumAdjustment: string;
  requestedByUserId: string;
  submittedToInsurerAt: string | null;
  insurerConfirmedAt: string | null;
  financialAdjustmentCalculatedAt: string | null;
  appliedAt: string | null;
  clientNotifiedAt: string | null;
  cancellation: {
    reason: string;
    basis: string;
    returnPremium: string;
    clientNotifiedAt: string | null;
  } | null;
  refund: {
    id: string;
    amount: string;
    reason: string;
    raisedByUserId: string;
    approvedByUserId: string | null;
    approvalThresholdMatrixLevel: string | null;
    paidAt: string | null;
    needsApproval: boolean;
  } | null;
  commissionReversal: { amount: string } | null;
  scheduleVersioned: boolean;
  createdAt: string;
}

export interface RequestEndorsementInput {
  type: 'POSITIVE' | 'NEGATIVE';
  changeType: EndorsementChangeType;
  premiumAmount: string;
  effectiveFrom: string;
  targetCoverage?: {
    limits: Record<string, unknown>;
    sumsInsured: Record<string, unknown>;
    namedPerils?: string[];
    extensions?: string[];
  };
}

export interface RequestCancellationInput {
  reason: string;
  basis: CancellationBasis;
  effectiveFrom: string;
}

export function listEndorsementsForPolicy(
  policyId: string,
): Promise<Endorsement[]> {
  return apiGet(`/policies/${encodeURIComponent(policyId)}/endorsements`);
}

export function requestEndorsement(
  policyId: string,
  input: RequestEndorsementInput,
): Promise<Endorsement> {
  return apiPost(
    `/policies/${encodeURIComponent(policyId)}/endorsements`,
    input,
  );
}

export function requestCancellation(
  policyId: string,
  input: RequestCancellationInput,
): Promise<Endorsement> {
  return apiPost(
    `/policies/${encodeURIComponent(policyId)}/cancellation`,
    input,
  );
}

export function advanceEndorsement(id: string): Promise<Endorsement> {
  return apiPost(`/endorsements/${encodeURIComponent(id)}/advance`, {});
}

export function calculateEndorsementAdjustment(
  id: string,
  premiumAmount?: string,
): Promise<Endorsement> {
  return apiPost(
    `/endorsements/${encodeURIComponent(id)}/calculate-adjustment`,
    premiumAmount ? { premiumAmount } : {},
  );
}

export function applyEndorsement(id: string): Promise<Endorsement> {
  return apiPost(`/endorsements/${encodeURIComponent(id)}/apply`, {});
}

export function approveEndorsementRefund(
  refundId: string,
): Promise<Endorsement> {
  return apiPost(`/refunds/${encodeURIComponent(refundId)}/approve`, {});
}

export function notifyEndorsementClient(id: string): Promise<Endorsement> {
  return apiPost(`/endorsements/${encodeURIComponent(id)}/notify-client`, {});
}
