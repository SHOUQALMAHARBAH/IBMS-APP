import {
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';
import { COMPLAINT_CATEGORIES } from '../complaint.config';

/**
 * Process 42 — `POST /complaints` (`complaint.log`). Logs a customer complaint
 * at status `LOGGED` and starts its resolution SLA timer.
 */
export class CreateComplaintDto {
  @IsUUID()
  customerId!: string;

  /** The issue — a Confidential-tier business note, stored + audited verbatim.
   * A full bank / card number belongs on an approved `PaymentChannel`
   * (Process 38), not here. */
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(5000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `issue ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  issue!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...COMPLAINT_CATEGORIES], {
    message: `category must be one of: ${COMPLAINT_CATEGORIES.join(', ')}`,
  })
  category?: string;

  /** The claim under dispute — optional, but if given it must belong to
   * `customerId` (422 mismatch, 404 unknown). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  claimId?: string;

  /** The policy the complaint concerns — optional, same ownership check. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  /** Optionally name the responsible employee at logging time. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  responsibleEmployeeUserId?: string;
}
