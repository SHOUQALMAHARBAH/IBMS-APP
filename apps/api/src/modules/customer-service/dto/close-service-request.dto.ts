import { Transform } from 'class-transformer';
import { Matches, MaxLength, MinLength } from 'class-validator';
import { trimIfString } from '../../../common/dto.util';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../service-request.config';

/**
 * Process 41 — the body for both `POST /service-requests/:id/fulfil` and
 * `POST /service-requests/:id/cancel`. `outcomeNote` is mandatory (what was
 * done / why cancelled) and logged verbatim — a Confidential-tier business
 * note; `@Matches` keeps a full account / card number out of it (Process 38's
 * `PaymentChannel` is where that data lives).
 */
export class CloseServiceRequestDto {
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `outcomeNote ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  outcomeNote!: string;
}
