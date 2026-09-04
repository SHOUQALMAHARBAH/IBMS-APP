import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import {
  FEEDBACK_CONTEXTS,
  FEEDBACK_SCORE_MAX,
  FEEDBACK_SCORE_MIN,
} from '../feedback.config';

/**
 * Process 45 — `POST /feedback` (`feedback.log` / Sales). Logs one
 * post-issuance / post-claim / post-renewal satisfaction survey response.
 * `submittedAt` defaults to `now()` but can be backdated when logging a
 * response captured after the fact (verbally on a call, on a paper form) —
 * a future instant is rejected in the service, not here, so the message can
 * explain why.
 */
export class CreateFeedbackDto {
  @IsUUID()
  customerId!: string;

  @IsIn([...FEEDBACK_CONTEXTS], {
    message: `context must be one of: ${FEEDBACK_CONTEXTS.join(', ')}`,
  })
  context!: string;

  @IsOptional()
  @IsInt()
  @Min(FEEDBACK_SCORE_MIN)
  @Max(FEEDBACK_SCORE_MAX)
  score?: number;

  /** The customer's own free-text remarks — Confidential tier, returned
   * unmasked, never in an audit row (see `feedbackAuditSnapshot`). */
  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  submittedAt?: string;
}
