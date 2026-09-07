import { IsIn, IsOptional, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../../common/dto.util';
import { COMPLAINT_ESCALATION_TARGETS } from '../complaint.config';

/** Process 42 — `POST /complaints/:id/escalate` (`complaint.escalate` /
 * MANAGER, COMPLIANCE). Routes an internally-unresolved complaint out; the
 * complaint moves `IN_PROGRESS -> ESCALATED` and an `EscalationRecord` is
 * written. `escalatedTo` defaults to the CBJ Insurance Dispute Resolution
 * Committee. */
export class EscalateComplaintDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...COMPLAINT_ESCALATION_TARGETS], {
    message: `escalatedTo must be one of: ${COMPLAINT_ESCALATION_TARGETS.join(', ')}`,
  })
  escalatedTo?: string;

  /** No `trimIfString` — `reason` has no `@MinLength`, so leading/trailing
   * whitespace is validation-irrelevant; a single `emptyStringToUndefined`
   * (matching `category` and the list DTO) keeps the empty-input normalisation
   * unambiguous (`''` -> undefined -> stored `null`). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @MaxLength(2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `reason ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  reason?: string;
}
