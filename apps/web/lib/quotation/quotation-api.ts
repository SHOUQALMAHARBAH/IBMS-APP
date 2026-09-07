// Process 13 — Quotation Management (backlog Part C #13, Domain B). Talks to
// apps/api's quotation module (quotation.controller.ts). Captures an
// insurer's quote against one RFQ line and versions it on every
// renegotiation — the old version is never overwritten.

import { apiGet, apiPost } from '../auth/api-client';

export interface QuotationInsurer {
  id: string;
  name: string;
  nameAr: string | null;
  financialStrengthRating: string | null;
}

/** One row in a version chain. Money fields are decimal strings as the API
 * serializes them (a JOD amount, fils precision on the column). */
export interface QuotationVersion {
  id: string;
  rfqId: string;
  insurerId: string;
  versionNumber: number;
  previousVersionId: string | null;
  isCurrentVersion: boolean;
  premium: string;
  currency: string;
  deductible: string | null;
  limits: Record<string, unknown> | null;
  biPeriodMonths: number | null;
  liabilityLimit: string | null;
  exclusions: string | null;
  conditions: string | null;
  commissionRatePercent: string | null;
  receivedAt: string;
  capturedByUserId: string | null;
  /** Part C #15 — the broker's rationale for the negotiation round this
   * version records. Always null on version 1 (an opening quote). */
  negotiationNotes: string | null;
  insurer: QuotationInsurer;
  rfq: { id: string; opportunityId: string; insuranceLine: string };
}

/** Part C #15 — one entry in a chain's negotiation history. Round 0 is the
 * opening quote; each later round carries the premium delta from the round
 * before it and the list of term fields that moved. */
export interface NegotiationRound {
  round: number;
  versionNumber: number;
  isCurrentVersion: boolean;
  receivedAt: string;
  capturedByUserId: string | null;
  premium: string;
  premiumDeltaFromPrevious: string | null;
  changedTermFields: string[];
  negotiationNotes: string | null;
}

/** One insurer's full quotation history on one RFQ line. */
export interface QuotationChain {
  rfqId: string;
  insurerId: string;
  insuranceLine: string;
  insurer: QuotationInsurer;
  current: QuotationVersion;
  versions: QuotationVersion[];
  history: NegotiationRound[];
}

/** The quote terms — shared by capture and revise. Every monetary field is
 * a fils-precision decimal string ("125000.500"); only `premium` is
 * required. */
export interface QuotationTermsInput {
  premium: string;
  currency?: string;
  deductible?: string;
  limits?: Record<string, unknown>;
  biPeriodMonths?: number;
  liabilityLimit?: string;
  exclusions?: string;
  conditions?: string;
  commissionRatePercent?: string;
}

export interface CaptureQuotationInput extends QuotationTermsInput {
  rfqId: string;
  insurerId: string;
}

/** Revise carries the full term set (it replaces, not patches) plus an
 * optional rationale for the round (Part C #15). */
export interface ReviseQuotationInput extends QuotationTermsInput {
  negotiationNotes?: string;
}

export function listQuotationsForRfq(
  rfqId: string,
): Promise<QuotationChain[]> {
  return apiGet(`/quotations?rfqId=${encodeURIComponent(rfqId)}`);
}

/** Every per-insurer quotation chain across all of an Opportunity's RFQs —
 * used by the Broker Recommendation form (Part C #16) to pick the
 * recommended quote. */
export function listQuotationsForOpportunity(
  opportunityId: string,
): Promise<QuotationChain[]> {
  return apiGet(
    `/quotations?opportunityId=${encodeURIComponent(opportunityId)}`,
  );
}

export function captureQuotation(
  input: CaptureQuotationInput,
): Promise<QuotationChain> {
  return apiPost('/quotations', input);
}

export function reviseQuotation(
  id: string,
  input: ReviseQuotationInput,
): Promise<QuotationChain> {
  return apiPost(`/quotations/${id}/revise`, input);
}
