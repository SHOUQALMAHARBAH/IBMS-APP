import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  MONEY_STRING,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 53-54 — `POST /pi-policy` (`pi-policy.manage` / Compliance). Logs
 * a NEW PI policy record — a renewal is a new row, not an in-place update
 * (see `pi-policy.config.ts`), so `claimsHistorySummary` history per period
 * is preserved rather than overwritten.
 */
export class CreatePiPolicyDto {
  @IsString()
  @Length(1, 200)
  insurerName!: string;

  @Matches(MONEY_STRING, {
    message:
      'coverageLimit must be a decimal string with at most 3 decimal places (fils precision), e.g. "500000.000"',
  })
  coverageLimit!: string;

  @IsString()
  expiresAt!: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `claimsHistorySummary ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  claimsHistorySummary?: string;
}
