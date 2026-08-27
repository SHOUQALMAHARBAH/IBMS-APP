// Process 5 — Needs Assessment. Talks to apps/api's needs-assessment module
// (needs-assessment.controller.ts). Mirrors lib/prospect/prospect-api.ts's
// conventions (thin typed wrappers over apiGet/apiPost/apiPatch).

import { apiGet, apiPatch, apiPost } from '../auth/api-client';

export type NeedsAssessmentStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'REVIEWED'
  | 'APPROVED'
  | 'REJECTED';

export type QuestionType = 'boolean' | 'number';

export interface NeedsAssessmentQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
}

export interface Questionnaire {
  questions: NeedsAssessmentQuestion[];
  coverageLines: string[];
}

export interface NeedsAssessment {
  id: string;
  riskProfileId: string;
  questionnaireAnswers: Record<string, boolean | number>;
  recommendedCoverageLines: string[];
  status: NeedsAssessmentStatus;
  createdByUserId: string;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListNeedsAssessmentsFilter {
  riskProfileId?: string;
  status?: NeedsAssessmentStatus;
}

export function getQuestionnaire(): Promise<Questionnaire> {
  return apiGet('/needs-assessments/questionnaire');
}

export function createNeedsAssessment(input: {
  riskProfileId: string;
  questionnaireAnswers: Record<string, boolean | number>;
}): Promise<NeedsAssessment> {
  return apiPost('/needs-assessments', input);
}

export function listNeedsAssessments(
  filter: ListNeedsAssessmentsFilter = {},
): Promise<NeedsAssessment[]> {
  const params = new URLSearchParams();
  if (filter.riskProfileId) params.set('riskProfileId', filter.riskProfileId);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return apiGet(`/needs-assessments${qs ? `?${qs}` : ''}`);
}

export function getNeedsAssessment(id: string): Promise<NeedsAssessment> {
  return apiGet(`/needs-assessments/${id}`);
}

export function updateNeedsAssessment(
  id: string,
  questionnaireAnswers: Record<string, boolean | number>,
): Promise<NeedsAssessment> {
  return apiPatch(`/needs-assessments/${id}`, { questionnaireAnswers });
}

export function submitNeedsAssessment(id: string): Promise<NeedsAssessment> {
  return apiPost(`/needs-assessments/${id}/submit`);
}

export function reviewNeedsAssessment(id: string): Promise<NeedsAssessment> {
  return apiPost(`/needs-assessments/${id}/review`);
}

export function approveNeedsAssessment(id: string): Promise<NeedsAssessment> {
  return apiPost(`/needs-assessments/${id}/approve`);
}

export function returnNeedsAssessment(
  id: string,
  reason: string,
): Promise<NeedsAssessment> {
  return apiPost(`/needs-assessments/${id}/return`, { reason });
}

export function rejectNeedsAssessment(
  id: string,
  reason: string,
): Promise<NeedsAssessment> {
  return apiPost(`/needs-assessments/${id}/reject`, { reason });
}
