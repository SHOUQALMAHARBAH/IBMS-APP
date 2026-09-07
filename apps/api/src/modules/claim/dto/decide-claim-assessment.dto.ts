import { IsIn } from 'class-validator';
import {
  CLAIM_ASSESSMENT_OUTCOMES,
  type ClaimAssessmentOutcome,
} from '../claim.config';

/**
 * Process 26 — record the insurer's assessment verdict, driving
 * `Claim UNDER_ASSESSMENT → APPROVED | PARTIALLY_APPROVED | DECLINED` through
 * the workflow engine. The four settlement figures are Process 28, not here.
 */
export class DecideClaimAssessmentDto {
  @IsIn(CLAIM_ASSESSMENT_OUTCOMES as readonly string[])
  outcome!: ClaimAssessmentOutcome;
}
