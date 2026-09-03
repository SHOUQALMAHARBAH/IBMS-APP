import {
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  SERVICE_REQUEST_TYPES,
} from '../service-request.config';

/**
 * Process 41 — `POST /service-requests` (`service-request.manage` / Sales,
 * Manager). Logs a customer service request (certificate / copy / change /
 * other) at status `open` and starts its fulfilment SLA timer.
 */
export class CreateServiceRequestDto {
  @IsUUID()
  customerId!: string;

  /** The policy the request is about — optional, but if given it must belong
   * to `customerId` (422 mismatch, 404 unknown). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsIn([...SERVICE_REQUEST_TYPES], {
    message: `requestType must be one of: ${SERVICE_REQUEST_TYPES.join(', ')}`,
  })
  requestType!: string;

  /** What specifically is requested — a Confidential-tier business note. A
   * full bank account / card number belongs on an approved `PaymentChannel`
   * (Process 38), not here (`@Matches` rejects a 9+-digit run). */
  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @MinLength(3)
  @MaxLength(2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `detail ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  detail?: string;

  /** Optionally assign the request to a handler at creation. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  assignedToUserId?: string;
}
