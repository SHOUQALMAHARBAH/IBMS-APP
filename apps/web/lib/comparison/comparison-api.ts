// Process 14 — Quote Comparison (backlog Part C #14, Domain B). Talks to
// apps/api's comparison module (comparison.controller.ts). One matrix per
// RFQ, (re)built from every current-version quotation; shortlisted insurers
// with no quote to compare are flagged.

import { apiFetchBlob, apiGet, apiPost } from '../auth/api-client';
import type { QuotationVersion } from '../quotation/quotation-api';

export interface ComparisonRow {
  id: string;
  quotationId: string;
  insurerQualityScore: string | null;
  serviceScore: string | null;
  quotation: QuotationVersion;
}

export interface FlaggedInsurer {
  id: string;
  name: string;
  status: string | null;
}

export interface ComparisonMatrix {
  id: string;
  rfqId: string;
  insuranceLine: string;
  builtAt: string;
  builtByUserId: string | null;
  rows: ComparisonRow[];
  missingInsurers: FlaggedInsurer[];
  declinedInsurers: FlaggedInsurer[];
}

export interface InsurerScoreInput {
  insurerId: string;
  insurerQualityScore?: string;
  serviceScore?: string;
}

export interface BuildComparisonInput {
  rfqId: string;
  scores?: InsurerScoreInput[];
}

/** 404 when no matrix has been built for the RFQ yet — callers treat that as
 * an empty state, not an error. */
export function getComparisonForRfq(
  rfqId: string,
): Promise<ComparisonMatrix> {
  return apiGet(`/comparison-matrices?rfqId=${encodeURIComponent(rfqId)}`);
}

export function buildComparison(
  input: BuildComparisonInput,
): Promise<ComparisonMatrix> {
  return apiPost('/comparison-matrices', input);
}

// Part F item #7 — bilingual quotation-comparison PDF. Omitting
// `language` defaults server-side to the customer's own
// languagePreference; 'DUAL' renders both, Arabic section first.
export function downloadComparisonDocument(
  id: string,
  language?: 'AR' | 'EN' | 'DUAL',
): Promise<Blob> {
  const qs = language ? `?language=${language}` : '';
  return apiFetchBlob(`/comparison-matrices/${id}/document${qs}`);
}
