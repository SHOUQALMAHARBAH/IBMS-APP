// Process 23-25 — Claim Notification + Registration + Documentation (backlog
// Part C #23-25, Domain C). Talks to apps/api's claim module: record a reported
// loss against a Policy (with coverage-at-loss-date validation), register it
// with the insurer + assign the adjuster (NOTIFIED -> REGISTERED), then file
// the mandatory documentation (a per-claim-type checklist), with the first
// attach advancing REGISTERED -> DOCUMENTATION_IN_PROGRESS.

import { apiGet, apiPost } from '../auth/api-client';

export const CLAIM_DOC_TYPE_OPTIONS = [
  'claim_form',
  'police_report',
  'medical_report',
  'photo',
  'invoice',
  'repair_estimate',
  'expert_report',
  'correspondence',
] as const;
export type ClaimDocType = (typeof CLAIM_DOC_TYPE_OPTIONS)[number];

export const CLAIM_DOC_CLASSIFICATION_OPTIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;
export type ClaimDocClassification =
  (typeof CLAIM_DOC_CLASSIFICATION_OPTIONS)[number];

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
  insurerClaimReference: string | null;
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
  adjuster: {
    name: string;
    firm: string | null;
    assignedAt: string;
    surveyCompletedAt: string | null;
    investigationCompletedAt: string | null;
  } | null;
  coverage: {
    scheduleId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  coverageResolvedAtLossDate: boolean;
  documents: {
    id: string;
    docType: ClaimDocType;
    category: string;
    classification: string;
    fileName: string;
    versionNumber: number;
    uploadedByUserId: string;
    createdAt: string;
  }[];
  documentChecklist: {
    docType: ClaimDocType;
    required: boolean;
    present: boolean;
  }[];
  documentationComplete: boolean;
  missingMandatoryDocuments: ClaimDocType[];
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

export interface RegisterClaimInput {
  insurerClaimReference: string;
  claimNumber?: string;
  adjuster: { name: string; firm?: string };
}

export function listClaimsForPolicy(policyId: string): Promise<Claim[]> {
  return apiGet(`/claims?policyId=${encodeURIComponent(policyId)}`);
}

export function notifyClaim(input: NotifyClaimInput): Promise<Claim> {
  return apiPost('/claims', input);
}

export function registerClaim(
  claimId: string,
  input: RegisterClaimInput,
): Promise<Claim> {
  return apiPost(`/claims/${encodeURIComponent(claimId)}/registration`, input);
}

export interface ClaimDocumentInput {
  docType: ClaimDocType;
  classification: ClaimDocClassification;
  fileName: string;
  storageRef: string;
}

export function attachClaimDocuments(
  claimId: string,
  documents: ClaimDocumentInput[],
): Promise<Claim> {
  return apiPost(`/claims/${encodeURIComponent(claimId)}/documents`, {
    documents,
  });
}
