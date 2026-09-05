import { Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/** Process 42 — `POST /complaints/:id/resolve`. `resolution` is mandatory
 * (what was concluded / offered) and logged verbatim; the closure sign-off
 * (`complaint.close` / MANAGER) then reviews it. */
export class ResolveComplaintDto {
  @Transform(trimIfString)
  @MinLength(10)
  @MaxLength(5000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `resolution ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  resolution!: string;
}
