// Process 7 — Product Recommendation / Program Design (backlog Part C #7).
// Talks to apps/api's insurance-program module
// (insurance-program.controller.ts). Mirrors lib/risk-profile/
// risk-profile-api.ts's conventions. Sum Insured bases are fils-precision
// decimal strings, never JS numbers (ibms-brain/meta/lex/money-decimal-jod.md).

import { apiGet, apiPost } from '../auth/api-client';

export type InsuranceProgramStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';

export interface InsuranceProgramLine {
  id: string;
  insuranceProgramId: string;
  insuranceLine: string;
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

export function listInsurancePrograms(
  customerId: string,
): Promise<InsuranceProgram[]> {
  return apiGet(
    `/insurance-programs?customerId=${encodeURIComponent(customerId)}`,
  );
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
