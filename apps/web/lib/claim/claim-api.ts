// Process 23-26 — Claim Notification + Registration + Documentation +
// Assessment (backlog Part C #23-26, Domain C). Talks to apps/api's claim
// module: record a reported loss against a Policy (with coverage-at-loss-date
// validation), register it with the insurer + assign the adjuster (NOTIFIED ->
// REGISTERED), file the mandatory documentation (a per-claim-type checklist,
// first attach -> DOCUMENTATION_IN_PROGRESS), then track the adjuster's survey
// / investigation, submit for insurer assessment (-> UNDER_ASSESSMENT, gated on
// the checklist) and record the verdict (-> APPROVED | PARTIALLY_APPROVED |
// DECLINED).

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

export const CLAIM_ASSESSMENT_OUTCOMES = [
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DECLINED',
] as const;
export type ClaimAssessmentOutcome = (typeof CLAIM_ASSESSMENT_OUTCOMES)[number];

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
  assessment: {
    surveyCompletedAt: string | null;
    investigationCompletedAt: string | null;
    adjusterWorkComplete: boolean;
    readyForAssessment: boolean;
    outcome: ClaimAssessmentOutcome | null;
  };
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

export interface AdjusterProgressInput {
  surveyCompletedAt?: string;
  investigationCompletedAt?: string;
}

/** Process 26 — stamp the loss adjuster's survey / investigation completion
 * (write-once per field). */
export function recordAdjusterProgress(
  claimId: string,
  input: AdjusterProgressInput,
): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/assessment/adjuster-progress`,
    input,
  );
}

/** Process 26 — submit the claim to the insurer for assessment
 * (DOCUMENTATION_IN_PROGRESS -> UNDER_ASSESSMENT). Gated server-side on the
 * mandatory-document checklist being complete. */
export function submitClaimForAssessment(claimId: string): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/assessment/submit`,
    {},
  );
}

/** Process 26 — record the insurer's verdict (UNDER_ASSESSMENT -> APPROVED |
 * PARTIALLY_APPROVED | DECLINED). */
export function decideClaimAssessment(
  claimId: string,
  outcome: ClaimAssessmentOutcome,
): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/assessment/decision`,
    { outcome },
  );
}
