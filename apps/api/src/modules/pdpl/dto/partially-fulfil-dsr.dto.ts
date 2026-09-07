import { IsString, Length, Matches } from 'class-validator';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../../../common/dto.util';

/** M04 — `POST /dsr/:id/partially-fulfil` (`dsr.handle`),
 * `IN_PROGRESS -> PARTIALLY_FULFILLED`. Both fields mandatory — the model's
 * own field pairing for exactly this outcome (a Deletion request that
 * cannot fully complete because a retention obligation is still open). */
export class PartiallyFulfilDsrDto {
  @IsString()
  @Length(1, 500)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `retentionScheduleReference ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  retentionScheduleReference!: string;

  @IsString()
  @Length(1, 1000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `partialFulfilmentJustification ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  partialFulfilmentJustification!: string;
}
