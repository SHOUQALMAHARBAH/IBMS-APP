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
  insurer: QuotationInsurer;
  rfq: { id: string; opportunityId: string; insuranceLine: string };
}

/** One insurer's full quotation history on one RFQ line. */
export interface QuotationChain {
  rfqId: string;
  insurerId: string;
  insuranceLine: string;
  insurer: QuotationInsurer;
  current: QuotationVersion;
  versions: QuotationVersion[];
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

export function listQuotationsForRfq(
  rfqId: string,
): Promise<QuotationChain[]> {
  return apiGet(`/quotations?rfqId=${encodeURIComponent(rfqId)}`);
}

export function captureQuotation(
  input: CaptureQuotationInput,
): Promise<QuotationChain> {
  return apiPost('/quotations', input);
}

export function reviseQuotation(
  id: string,
  input: QuotationTermsInput,
): Promise<QuotationChain> {
  return apiPost(`/quotations/${id}/revise`, input);
}
