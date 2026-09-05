import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 53 — `POST /risk-register/:id/mitigation` (`risk-register.manage`
 * / Compliance or Manager). Legal only while the item is still `open` — see
 * `risk-register.repository.ts`'s `recordMitigation`.
 */
export class UpdateRiskRegisterMitigationDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `mitigationAction ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  mitigationAction!: string;
}
