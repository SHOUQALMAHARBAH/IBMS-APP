// Process 16 — Broker Recommendation (backlog Part C #16, Domain B). Talks to
// apps/api's recommendation module (recommendation.controller.ts): draft the
// documented recommendation, clear the senior-officer approval gate and the
// mandatory conflict-of-interest disclosure, then send it to the client.

import { apiGet, apiPost } from '../auth/api-client';

export interface RecommendationInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

export interface RationaleFactors {
  coverage: string;
  price: string;
  financialStrength: string;
  claimsService: string;
  deductible: string;
  policyConditions: string;
}

export const RATIONALE_FACTOR_FIELDS: {
  key: keyof RationaleFactors;
  label: string;
}[] = [
  { key: 'coverage', label: 'Coverage' },
  { key: 'price', label: 'Price' },
  { key: 'financialStrength', label: 'Insurer financial strength' },
  { key: 'claimsService', label: 'Claims service' },
  { key: 'deductible', label: 'Deductible' },
  { key: 'policyConditions', label: 'Policy conditions' },
];

export interface ConflictOfInterestDisclosure {
  id: string;
  competingQuotationId: string | null;
  commissionDifferencePercent: string | null;
  disclosureText: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
}

export interface Recommendation {
  id: string;
  opportunityId: string;
  customerId: string;
  recommendedQuotation: {
    id: string;
    insurerId: string;
    insurer: RecommendationInsurer;
    insuranceLine: string;
    premium: string;
    currency: string;
    commissionRatePercent: string | null;
  };
  rationale: string;
  rationaleFactors: RationaleFactors;
  approvalRequired: boolean;
  approvedByUserId: string | null;
  approvedAt: string | null;
  conflictOfInterestFlagged: boolean;
  coiCompetingQuotationId: string | null;
  coiCommissionDiffPercent: string | null;
  conflictOfInterestDisclosure: ConflictOfInterestDisclosure | null;
  sentToClientAt: string | null;
  sentByUserId: string | null;
  draftedByUserId: string;
  createdAt: string;
  blockedFromSend: string[];
}

export interface DraftRecommendationInput {
  opportunityId: string;
  recommendedQuotationId: string;
  rationale: string;
  rationaleFactors: RationaleFactors;
}

export function listRecommendationsForOpportunity(
  opportunityId: string,
): Promise<Recommendation[]> {
  return apiGet(
    `/recommendations?opportunityId=${encodeURIComponent(opportunityId)}`,
  );
}

export function draftRecommendation(
  input: DraftRecommendationInput,
): Promise<Recommendation> {
  return apiPost('/recommendations', input);
}

export function approveRecommendation(id: string): Promise<Recommendation> {
  return apiPost(`/recommendations/${id}/approve`);
}

export function discloseConflictOfInterest(
  id: string,
  disclosureText: string,
  competingQuotationId?: string,
): Promise<Recommendation> {
  return apiPost(`/recommendations/${id}/conflict-of-interest-disclosure`, {
    disclosureText,
    ...(competingQuotationId ? { competingQuotationId } : {}),
  });
}

export function sendRecommendation(id: string): Promise<Recommendation> {
  return apiPost(`/recommendations/${id}/send`);
}
