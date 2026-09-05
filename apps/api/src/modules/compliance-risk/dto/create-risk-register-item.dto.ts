import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';
import { RISK_REGISTER_TYPES } from '../risk-register.config';

/**
 * Process 53 — `POST /risk-register` (`risk-register.manage` / Compliance
 * or Manager). `loggedAt` defaults to `now()` but can be backdated (the
 * #10/#12/#44/#45 shape) — a risk is often identified/discussed before it
 * gets formally entered.
 */
export class CreateRiskRegisterItemDto {
  @IsIn(RISK_REGISTER_TYPES, {
    message: `riskType must be one of: ${RISK_REGISTER_TYPES.join(', ')}`,
  })
  riskType!: string;

  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `description ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  description!: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `mitigationAction ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  mitigationAction?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  loggedAt?: string;
}
