import { IsOptional, IsString, Length } from 'class-validator';

/** Shared by `POST /needs-assessments/:id/return` and `.../reject` (both
 * `needs-assessment.approve` — the Branch/Department Manager's decision
 * actions). `reason` is optional at the DTO level but the service enforces
 * it as required on both a return-to-draft and a reject — sending an
 * assessment back with no explanation is not a real decision. */
export class NeedsAssessmentDecisionDto {
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
