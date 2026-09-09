import { IsIn, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * Process 49 — a Compliance Officer's decision on a queued sanctions match.
 *
 * `reviewReason` is mandatory on BOTH outcomes, with a real minimum length.
 * "Cleared" with no stated basis is indistinguishable from "ignored", and
 * this text is the substance of the control — it is what a regulator asks to
 * see when questioning why a name that matched a sanctions list was let
 * through. Same reasoning as the mandatory `reason` on a commission override.
 */
export class ReviewScreeningMatchDto {
  @IsIn(['cleared', 'confirmed'], {
    message: "decision must be 'cleared' (false positive) or 'confirmed'",
  })
  decision!: 'cleared' | 'confirmed';

  @Transform(trimIfString)
  @IsString()
  @Length(10, 2000, {
    message: 'reviewReason must explain the decision (at least 10 characters)',
  })
  reviewReason!: string;
}
