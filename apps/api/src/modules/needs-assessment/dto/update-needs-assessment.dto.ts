import { IsDefined, IsObject } from 'class-validator';

/** Process 5 — re-captures the questionnaire while the assessment is still
 * in DRAFT (the service rejects an update in any other status).
 * `recommendedCoverageLines` is re-derived from the new answers, never
 * accepted from the caller. */
export class UpdateNeedsAssessmentDto {
  @IsDefined()
  @IsObject()
  questionnaireAnswers!: Record<string, unknown>;
}
