// Process 14 — Quote Comparison (backlog Part C #14, Domain B). Talks to
// apps/api's comparison module (comparison.controller.ts). One matrix per
// RFQ, (re)built from every current-version quotation; shortlisted insurers
// with no quote to compare are flagged.

import { apiGet, apiPost } from '../auth/api-client';
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
