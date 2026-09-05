import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
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
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
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
   * unmasked, never in an audit row (see `feedbackAuditSnapshot`). Solicited
   * right after a claim settlement / policy issuance / renewal, so a full
   * bank / card number is a plausible thing to land here; `@Matches` keeps it
   * out (the #41 / #42 / #44 guard). */
  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `comments ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  comments?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  submittedAt?: string;
}
