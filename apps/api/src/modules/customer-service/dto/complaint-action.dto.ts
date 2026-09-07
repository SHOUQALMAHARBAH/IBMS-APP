import { Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/** Process 42 — `POST /complaints/:id/actions`. Appends a `ComplaintAction`
 * (what was done) while the complaint is open. Logged verbatim. */
export class ComplaintActionDto {
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `actionText ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  actionText!: string;
}
