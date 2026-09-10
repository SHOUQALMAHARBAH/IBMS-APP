import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

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

/**
 * Process 49 — filter for the review queue.
 *
 * `status` was previously an unvalidated free string passed straight into the
 * Prisma `where`. Not injectable, but `?status=Pending` (or an empty string)
 * silently returned an EMPTY queue — a Compliance Officer would read that as
 * "nothing to review" rather than "you mistyped a filter". On a control whose
 * whole purpose is that somebody looks at the list, a silent empty result is
 * the wrong failure. Constrained to the three real values, the same way
 * `ReviewScreeningMatchDto` already constrains `decision`.
 */
export class ListScreeningMatchesDto {
  @IsOptional()
  @Transform(trimIfString)
  @IsIn(['pending', 'cleared', 'confirmed'], {
    message: "status must be one of: 'pending', 'cleared', 'confirmed'",
  })
  status?: 'pending' | 'cleared' | 'confirmed';

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  kycRecordId?: string;
}
