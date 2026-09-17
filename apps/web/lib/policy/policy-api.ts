// Process 18-19 — Policy Placement & Issuance (backlog Part C #18-19, Domain
// B). Talks to apps/api's policy module (policy.controller.ts): creates the
// Policy from an accepted Opportunity (inception date set at placement),
// then records the insurer-issued policy/schedule/documents/premium invoice.

import type { Paginated } from '../api/paginated';
import { apiFetchBlob, apiGet, apiPost } from '../auth/api-client';

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
  method: DeliveryMethod;
  recipient: string;
  receiptAcknowledgedAt: string | null;
}

export interface Policy {
  id: string;
  opportunityId: string;
  customerId: string;
  /** Identity only — enough for a list row to name its client. */
  customer: { id: string; legalName: string } | null;
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

/** Scoped to one opportunity, so at most one policy comes back — but the
 *  endpoint returns the same envelope on every branch, and unwrapping it here
 *  keeps that detail out of the two callers that only ever wanted the rows. */
export async function listPoliciesForOpportunity(
  opportunityId: string,
): Promise<Policy[]> {
  const page: Paginated<Policy> = await apiGet(
    `/policies?opportunityId=${encodeURIComponent(opportunityId)}`,
  );
  return page.items;
}

/**
 * The book-wide policy list. With no opportunity/customer scope the API
 * returns what THIS caller may see — the whole book for Placement /
 * Manager / Executive / Policy Checking, and only policies on customers they
 * own for anyone else. The filtering happens in the query, so the page window
 * narrows matching rows rather than rows scanned.
 */
export function listPolicies(
  params: { status?: PolicyStatus; search?: string; page?: number } = {},
): Promise<Paginated<Policy>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  // Sent only past the first page, so the common request keeps the URL it has
  // always had and the server's own default decides the size.
  if (params.page) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiGet(`/policies${suffix ? `?${suffix}` : ''}`);
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

// Part F item #7 — bilingual policy-schedule-summary PDF. Omitting
// `language` defaults server-side to the customer's own
// languagePreference; 'DUAL' renders both, Arabic section first. The
// api refuses (422) until the policy has been issued — mirrored here by
// only showing the button once `schedules.length > 0` (see
// PolicySection.tsx).
export function downloadPolicyScheduleDocument(
  id: string,
  language?: 'AR' | 'EN' | 'DUAL',
): Promise<Blob> {
  const qs = language ? `?language=${language}` : '';
  return apiFetchBlob(`/policies/${encodeURIComponent(id)}/document${qs}`);
}

// Part F item #7 — bilingual certificate-of-insurance PDF, the 6th and
// final of the 6 named document types. Same defaulting/gating shape as
// downloadPolicyScheduleDocument above, but a genuinely different content
// endpoint (short proof-of-coverage, not the full schedule).
export function downloadPolicyCertificateDocument(
  id: string,
  language?: 'AR' | 'EN' | 'DUAL',
): Promise<Blob> {
  const qs = language ? `?language=${language}` : '';
  return apiFetchBlob(`/policies/${encodeURIComponent(id)}/certificate${qs}`);
}
