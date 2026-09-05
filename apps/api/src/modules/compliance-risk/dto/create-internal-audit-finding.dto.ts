import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 57 — `POST /internal-audit-findings` (`internal-audit.record` /
 * Compliance). `loggedAt` defaults to `now()` but can be backdated (the
 * #10/#12/#44/#45/#53 shape) — a finding is often discussed before it gets
 * formally entered.
 */
export class CreateInternalAuditFindingDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 300)
  auditPeriodLabel!: string;

  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `finding ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  finding!: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `remediationAction ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  remediationAction?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  loggedAt?: string;
}
