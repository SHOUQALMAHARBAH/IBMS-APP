// Process 23 — Claim Notification (backlog Part C #23, Domain C). Talks to
// apps/api's claim module (claim.controller.ts): record a reported loss against
// a Policy (loss date/location/cause, estimated loss, third-party involvement)
// at ClaimStatus.NOTIFIED. Coverage in force at the exact loss date is
// validated server-side against the policy's PolicySchedule version windows.

import { apiGet, apiPost } from '../auth/api-client';

export type ClaimStatus =
  | 'NOTIFIED'
  | 'REGISTERED'
  | 'DOCUMENTATION_IN_PROGRESS'
  | 'UNDER_ASSESSMENT'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'DECLINED'
  | 'SETTLED'
  | 'CLOSED';

export interface ClaimStatusHistoryEntry {
  fromStatus: ClaimStatus | null;
  toStatus: ClaimStatus;
  changedByUserId: string;
  changedAt: string;
}

export interface Claim {
  id: string;
  policyId: string;
  customerId: string;
  policyNumber: string | null;
  insuranceLine: string;
  claimNumber: string | null;
  status: ClaimStatus;
  lossDate: string;
  lossLocation: string | null;
  causeOfLoss: string | null;
  estimatedLoss: string;
  isThirdPartyInvolved: boolean;
  isLargeClaim: boolean;
  classification: string;
  followUpAlertThresholdDays: number;
  thirdParty: {
    fullName: string | null;
    subrogationRecoveryFlag: boolean;
  } | null;
  coverage: {
    scheduleId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  coverageResolvedAtLossDate: boolean;
  statusHistory: ClaimStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface NotifyClaimInput {
  policyId: string;
  lossDate: string;
  causeOfLoss: string;
  lossLocation?: string;
  estimatedLoss: string;
  isThirdPartyInvolved?: boolean;
  thirdParty?: {
    fullName?: string;
    contactDetails?: string;
    subrogationRecoveryFlag?: boolean;
  };
}

export function listClaimsForPolicy(policyId: string): Promise<Claim[]> {
  return apiGet(`/claims?policyId=${encodeURIComponent(policyId)}`);
}

export function notifyClaim(input: NotifyClaimInput): Promise<Claim> {
  return apiPost('/claims', input);
}
