// Process 16 — Broker Recommendation (backlog Part C #16, Domain B). Talks to
// apps/api's recommendation module (recommendation.controller.ts): draft the
// documented recommendation, clear the senior-officer approval gate and the
// mandatory conflict-of-interest disclosure, then send it to the client.

import { apiFetchBlob, apiGet, apiPost } from '../auth/api-client';
import type { DiscardBlock } from '../discard/discard-api';

export interface RecommendationInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
  /** FALSE when the office has stopped dealing with this insurer.
   *
   *  Every surface that lets someone CHOOSE an insurer has to show this, because
   *  capturing a quotation from a deactivated insurer stays deliberately legal — a
   *  recorded premium is a factual event. So such a quote reaches the comparison
   *  and can be recommended, and without a marker a broker could present it and a
   *  client choose it, with nobody finding out until placement refused. */
  isActive: boolean;
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
  /**
   * Set once this record was withdrawn as raised in error — null on every live one. The record STAYS in every
   * list; a surface that showed one without this block would read as a live record.
   */
  discard: DiscardBlock | null;
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

export function approveRecommendation(
id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<Recommendation> {
  return apiPost(`/recommendations/${id}/approve`, combinedDutyReason ? { combinedDutyReason } : {});
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

// Part F item #7 — bilingual recommendation-report PDF. Omitting
// `language` defaults server-side to the customer's own
// languagePreference; 'DUAL' renders both, Arabic section first. The api
// refuses (422) while a required approval or COI disclosure is still
// outstanding — mirrored here by only showing the button once
// `blockedFromSend` is empty (see RecommendationSection.tsx).
export function downloadRecommendationDocument(
  id: string,
  language?: 'AR' | 'EN' | 'DUAL',
): Promise<Blob> {
  const qs = language ? `?language=${language}` : '';
  return apiFetchBlob(`/recommendations/${id}/document${qs}`);
}
