// Process 23-29 — Claim Notification + Registration + Documentation +
// Assessment + Follow-up + Settlement + Closure (backlog Part C #23-29, Domain
// C). Talks to apps/api's claim module: record a reported loss against a Policy
// (with coverage-at-loss-date validation), register it with the insurer +
// assign the adjuster (NOTIFIED -> REGISTERED), file the mandatory
// documentation (a per-claim-type checklist, first attach ->
// DOCUMENTATION_IN_PROGRESS), track the adjuster's survey / investigation,
// submit for insurer assessment (-> UNDER_ASSESSMENT, gated on the checklist),
// record the verdict (-> APPROVED | PARTIALLY_APPROVED | DECLINED), raise /
// resolve insurer non-response follow-up alerts, record the settlement's four
// distinct figures with a mandatory second approver for large / broker-processed
// payments (-> SETTLED), and formally close the claim once the client's payment
// receipt is confirmed (-> CLOSED, triggering a Loss Ratio recompute).

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
  followUp: {
    followUpAlerts: {
      id: string;
      triggeredAt: string;
      resolvedAt: string | null;
    }[];
    followUpAlertOpen: boolean;
    followUpAlertThresholdDays: number;
    awaitingInsurerResponse: boolean;
    awaitingInsurerSince: string | null;
  };
  settlement: {
    estimatedLoss: string;
    approvedAmount: string | null;
    deductible: string | null;
    netSettlement: string | null;
    brokerProcessedPayment: boolean;
    approvedByUserId: string | null;
    secondApproverUserId: string | null;
    secondApproverRequired: boolean;
    settled: boolean;
    clientPaymentConfirmedAt: string | null;
  } | null;
  closedAt: string | null;
  statusHistory: ClaimStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordSettlementInput {
  approvedAmount: string;
  deductible: string;
  brokerProcessedPayment?: boolean;
}

export interface ClaimFollowUpScanResult {
  awaiting: number;
  due: number;
  raised: number;
  skippedAlreadyAlerted: number;
  autoResolved: number;
  failed: number;
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

/** Process 27 — run the insurer non-response follow-up sweep now (otherwise
 * nightly). Returns counts only. */
export function runClaimFollowUpSweep(): Promise<ClaimFollowUpScanResult> {
  return apiPost('/claims/follow-up-sweep', {});
}

/** Process 27 — manually resolve an open follow-up alert (the claim's status
 * is not touched). */
export function resolveClaimFollowUpAlert(
  claimId: string,
  alertId: string,
): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/follow-up-alerts/${encodeURIComponent(
      alertId,
    )}/resolve`,
    {},
  );
}

/** Process 28 — record the settlement's four distinct figures (first
 * approver). Settles the claim straight through unless a second approver is
 * required. */
export function recordClaimSettlement(
  claimId: string,
  input: RecordSettlementInput,
): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/settlement`,
    input,
  );
}

/** Process 28 — the mandatory second approval (never the first approver). */
export function secondApproveClaimSettlement(claimId: string): Promise<Claim> {
  return apiPost(
    `/claims/${encodeURIComponent(claimId)}/settlement/second-approve`,
    {},
  );
}

export interface CloseClaimInput {
  /** required to close a SETTLED claim (the client's receipt of the settlement
   * payment); omit for a DECLINED claim. */
  clientPaymentConfirmedAt?: string;
}

/** Process 29 — formal closure. `SETTLED → CLOSED` once the client's payment
 * receipt is confirmed; `DECLINED → CLOSED` directly. Triggers a Loss Ratio
 * recompute for the policy. */
export function closeClaim(
  claimId: string,
  input: CloseClaimInput = {},
): Promise<Claim> {
  return apiPost(`/claims/${encodeURIComponent(claimId)}/closure`, input);
}
