// Process 7 — Product Recommendation / Program Design (backlog Part C #7).
// Talks to apps/api's insurance-program module
// (insurance-program.controller.ts). Mirrors lib/risk-profile/
// risk-profile-api.ts's conventions. Sum Insured bases are fils-precision
// decimal strings, never JS numbers (ibms-brain/meta/lex/money-decimal-jod.md).

import { apiGet, apiPost } from '../auth/api-client';
import type { Paginated } from '../api/paginated';

export type InsuranceProgramStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';

export interface InsuranceProgramLine {
  id: string;
  insuranceProgramId: string;
  insuranceLine: string;
  /** §P4 — the line's Arabic name, sent by the server. null when none is known. */
  insuranceLineAr: string | null;
  sumInsuredBasis: string | null;
}

export interface SumInsuredSummary {
  propertySumInsured: string;
  businessInterruptionSumInsured: string;
  totalSumInsured: string;
  indemnityPeriodMonths: number | null;
  fleetVehicleCount: number;
  assetCount: number;
}

export interface InsuranceProgramContext {
  needsAssessmentId: string | null;
  needsAssessmentStatus:
    | 'DRAFT'
    | 'PENDING_REVIEW'
    | 'REVIEWED'
    | 'APPROVED'
    | 'REJECTED'
    | null;
  recommendedCoverageLines: string[];
  riskProfileId: string;
  customerId: string | null;
  siteLabel: string | null;
  sumInsured: SumInsuredSummary;
  surveyComplete: boolean;
}

export interface InsuranceProgram {
  id: string;
  riskProfileId: string;
  needsAssessmentId: string | null;
  assembledByUserId: string | null;
  status: InsuranceProgramStatus;
  createdAt: string;
  lines: InsuranceProgramLine[];
}

export interface InsuranceProgramWithContext extends InsuranceProgram {
  context: InsuranceProgramContext;
}

export function assembleInsuranceProgram(
  needsAssessmentId: string,
): Promise<InsuranceProgramWithContext> {
  return apiPost('/insurance-programs', { needsAssessmentId });
}

/** 🔴 OWNER DECISION 150 RULING 1 — every list row names its customer. */
export interface InsuranceProgramListRow extends InsuranceProgram {
  riskProfile: { customer: { id: string; legalName: string } };
}

/** One customer's programmes. Unwrapped to an array so this function keeps the shape its
 *  callers have always had. */
export async function listInsurancePrograms(
  customerId: string,
): Promise<InsuranceProgramListRow[]> {
  const page: Paginated<InsuranceProgramListRow> = await apiGet(
    `/insurance-programs?customerId=${encodeURIComponent(customerId)}`,
  );
  return page.items;
}

/**
 * 🔴 OWNER DECISION 150 RULING 1 — THE BOOK-WIDE LIST. Same visibility rule as `/policies`:
 * `customer-file.all-owners.read` reaches the whole book, everybody else only the programmes on
 * customers they own, ⛔ decided in the query.
 */
export function listAllInsurancePrograms(
  params: { search?: string; page?: number } = {},
): Promise<Paginated<InsuranceProgramListRow>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiGet(`/insurance-programs${suffix ? `?${suffix}` : ''}`);
}

export function getInsuranceProgram(
  id: string,
): Promise<InsuranceProgramWithContext> {
  return apiGet(`/insurance-programs/${id}`);
}

export function reassembleInsuranceProgram(
  id: string,
): Promise<InsuranceProgramWithContext> {
  return apiPost(`/insurance-programs/${id}/reassemble`);
}

export function finalizeInsuranceProgram(
  id: string,
): Promise<InsuranceProgramWithContext> {
  return apiPost(`/insurance-programs/${id}/finalize`);
}

export function reopenInsuranceProgram(
  id: string,
): Promise<InsuranceProgramWithContext> {
  return apiPost(`/insurance-programs/${id}/reopen`);
}
