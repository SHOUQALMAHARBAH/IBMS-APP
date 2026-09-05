// Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
// B). Talks to apps/api's policy module (policy.controller.ts): creates the
// Policy from an accepted Opportunity (inception date set at placement),
// then records the insurer-issued policy/schedule/documents/premium invoice.

import { apiGet, apiPost } from '../auth/api-client';

export type PolicyStatus =
  | 'PLACEMENT_CONFIRMED'
  | 'ISSUED'
  | 'CHECKING_IN_PROGRESS'
  | 'DISCREPANCY'
  | 'VERIFIED'
  | 'DELIVERED'
  | 'ACTIVE'
  | 'CANCELLED'
  | 'EXPIRED';

export const DOCUMENT_CATEGORY_OPTIONS = [
  'APPLICATION_PROPOSAL',
  'RISK_SURVEY',
  'QUOTATION',
  'COMPARISON',
  'RECOMMENDATION',
  'CLIENT_APPROVAL',
  'POLICY',
  'ENDORSEMENT',
  'INVOICE',
  'RECEIPT',
  'CLAIM',
  'CORRESPONDENCE',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORY_OPTIONS)[number];

export const DATA_CLASSIFICATION_OPTIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
] as const;
export type DataClassification = (typeof DATA_CLASSIFICATION_OPTIONS)[number];

export interface PolicyDocumentInput {
  category: DocumentCategory;
  classification: DataClassification;
  fileName: string;
  storageRef: string;
}

export interface PolicyDocument extends PolicyDocumentInput {
  id: string;
  versionNumber: number;
  previousVersionId: string | null;
  uploadedByUserId: string;
  createdAt: string;
}

export interface PolicySchedule {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  limits: Record<string, unknown>;
  sumsInsured: Record<string, unknown>;
  namedPerils: string[];
  extensions: string[];
  sourceEndorsementId: string | null;
  createdAt: string;
}

export interface PolicyChecking {
  placedByUserId: string;
  checkedByUserId: string | null;
  checkedAt: string | null;
  discrepancyFound: boolean;
  discrepancyDetail: string | null;
  discrepancyLoggedAsPiRiskEvent: boolean;
  complianceOverrideByUserId: string | null;
  checklist: unknown;
  createdAt: string;
}

export const DELIVERY_METHOD_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'portal', label: 'Client portal' },
  { value: 'courier', label: 'Courier' },
  { value: 'in_person', label: 'In person' },
] as const;
export type DeliveryMethod = (typeof DELIVERY_METHOD_OPTIONS)[number]['value'];

export interface PolicyDelivery {
  deliveredAt: string;
  method: string;
  recipient: string;
  receiptAcknowledgedAt: string | null;
}

export interface Policy {
  id: string;
  opportunityId: string;
  customerId: string;
  insurerId: string;
  insurer: { id: string; name: string; nameAr: string | null } | null;
  policyNumber: string | null;
  insuranceLine: string;
  status: PolicyStatus;
  inceptionDate: string | null;
  expiryDate: string | null;
  requestedPremium: string;
  issuedPremium: string | null;
  premiumVariance: string | null;
  currency: string;
  placedByUserId: string | null;
  issuedByUserId: string | null;
  schedules: PolicySchedule[];
  documents: PolicyDocument[];
  checking: PolicyChecking | null;
  delivery: PolicyDelivery | null;
  issuanceComplete: boolean;
  checkingComplete: boolean;
  deliveryComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestedCoverageInput {
  limits: Record<string, unknown>;
  sumsInsured: Record<string, unknown>;
  namedPerils?: string[];
  extensions?: string[];
}

export interface PlacePolicyInput {
  opportunityId: string;
  inceptionDate: string;
  expiryDate?: string;
}

export interface RecordPolicyIssuanceInput {
  policyNumber: string;
  issuedPremium: string;
  inceptionDate?: string;
  expiryDate?: string;
  schedule: {
    effectiveFrom?: string;
    limits: Record<string, unknown>;
    sumsInsured: Record<string, unknown>;
    namedPerils?: string[];
    extensions?: string[];
  };
  documents: PolicyDocumentInput[];
}

export function listPoliciesForOpportunity(
  opportunityId: string,
): Promise<Policy[]> {
  return apiGet(`/policies?opportunityId=${encodeURIComponent(opportunityId)}`);
}

export function placePolicy(input: PlacePolicyInput): Promise<Policy> {
  return apiPost('/policies', input);
}

export function recordPolicyIssuance(
  id: string,
  input: RecordPolicyIssuanceInput,
): Promise<Policy> {
  return apiPost(`/policies/${encodeURIComponent(id)}/issuance`, input);
}

export function attachPolicyDocuments(
  id: string,
  documents: PolicyDocumentInput[],
): Promise<Policy> {
  return apiPost(`/policies/${encodeURIComponent(id)}/documents`, {
    documents,
  });
}

export function checkPolicy(
  id: string,
  requestedCoverage: RequestedCoverageInput,
): Promise<Policy> {
  return apiPost(`/policies/${encodeURIComponent(id)}/checking`, {
    requestedCoverage,
  });
}

export function recordPolicyDelivery(
  id: string,
  input: { method: DeliveryMethod; recipient: string; deliveredAt?: string },
): Promise<Policy> {
  return apiPost(`/policies/${encodeURIComponent(id)}/delivery`, input);
}

export function acknowledgePolicyReceipt(
  id: string,
  acknowledgedAt?: string,
): Promise<Policy> {
  return apiPost(
    `/policies/${encodeURIComponent(id)}/delivery/acknowledge-receipt`,
    acknowledgedAt ? { acknowledgedAt } : {},
  );
}
