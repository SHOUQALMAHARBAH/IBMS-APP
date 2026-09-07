import { IsDefined, IsObject, IsUUID } from 'class-validator';

/** Process 5 — captures a Needs Assessment against an existing Risk Profile.
 * `questionnaireAnswers` is only shape-checked here (an object); the real
 * per-question validation is `parseQuestionnaireAnswers()` in
 * needs-assessment.config.ts, run by the service, because the expected keys
 * are driven by `NEEDS_ASSESSMENT_QUESTIONS` rather than a fixed field list.
 * `recommendedCoverageLines` is derived, never accepted from the caller. */
export class CreateNeedsAssessmentDto {
  @IsUUID()
  riskProfileId!: string;

  @IsDefined()
  @IsObject()
  questionnaireAnswers!: Record<string, unknown>;
}
