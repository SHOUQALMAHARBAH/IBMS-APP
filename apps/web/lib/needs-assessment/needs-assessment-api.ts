import type { CombinedDutyActOnRecord } from "../../components/ui/CombinedDutyOnRecord";
// Process 5 — Needs Assessment. Talks to apps/api's needs-assessment module
// (needs-assessment.controller.ts). Mirrors lib/prospect/prospect-api.ts's
// conventions (thin typed wrappers over apiGet/apiPost/apiPatch).

import { apiGet, apiPatch, apiPost } from "../auth/api-client";

export type NeedsAssessmentStatus =
  "DRAFT" | "PENDING_REVIEW" | "REVIEWED" | "APPROVED" | "REJECTED";

export type QuestionType = "boolean" | "number";

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
  /**
   * Part 4 step 5 — TWO acts, because this is the only one of the fifteen pairs' tables carrying two of
   * them: `NeedsAssessment_reviewer_maker_checker_distinct` (the capturer is not the reviewer) and
   * `NeedsAssessment_approver_maker_checker_distinct` (the capturer is not the approver).
   *
   * Deliberately NOT one field. One would say "somebody doubled up here" without saying whether it was
   * the review or the approval — which is the distinction the two database columns exist to keep, and
   * without which a declared combined REVIEW would read as excusing a self-APPROVAL.
   */
  reviewerCombinedDutyAct: CombinedDutyActOnRecord | null;
  approverCombinedDutyAct: CombinedDutyActOnRecord | null;
  createdAt: string;
  updatedAt: string;
  /** Resolved off the parent Risk Profile — Part D §5.1 touchpoint #3
   * (needs & risk assessment) needs it for the detail page's
   * consent-capture control. */
  customerId: string;
}

export interface ListNeedsAssessmentsFilter {
  riskProfileId?: string;
  status?: NeedsAssessmentStatus;
}

export function getQuestionnaire(): Promise<Questionnaire> {
  return apiGet("/needs-assessments/questionnaire");
}

export function createNeedsAssessment(input: {
  riskProfileId: string;
  questionnaireAnswers: Record<string, boolean | number>;
}): Promise<NeedsAssessment> {
  return apiPost("/needs-assessments", input);
}

export function listNeedsAssessments(
  filter: ListNeedsAssessmentsFilter = {},
): Promise<NeedsAssessment[]> {
  const params = new URLSearchParams();
  if (filter.riskProfileId) params.set("riskProfileId", filter.riskProfileId);
  if (filter.status) params.set("status", filter.status);
  const qs = params.toString();
  return apiGet(`/needs-assessments${qs ? `?${qs}` : ""}`);
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

export function reviewNeedsAssessment(
  id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<NeedsAssessment> {
  return apiPost(
    `/needs-assessments/${id}/review`,
    combinedDutyReason ? { combinedDutyReason } : {},
  );
}

export function approveNeedsAssessment(
  id: string,
  /**
   * Part 4 — sent only when the approver IS the maker and the office has declared COMBINED mode. Omitted on
   * every ordinary two-person approval, which sends the same body it always did.
   */
  combinedDutyReason?: string,
): Promise<NeedsAssessment> {
  return apiPost(
    `/needs-assessments/${id}/approve`,
    combinedDutyReason ? { combinedDutyReason } : {},
  );
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
