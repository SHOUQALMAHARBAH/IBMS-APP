import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * `GET /dashboards/policy` (`dashboard.policy.view`). See
 * `policy-dashboard.config.ts`'s header comment: `branchId`/`insuranceLine`/
 * `insurerId` scope every metric; `periodLabel`/`periodStart`/`periodEnd`
 * (all-or-none, the #60/#61 shape) scope ONLY newPoliciesIssuedCount and
 * cancelledPolicies — active/expiring counts are always a live snapshot.
 * `renewalWindowDays` (default 90, `RenewalCase.leadTimeDays`'s own
 * default) controls the expiring-policies window.
 */
export class PolicyDashboardQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  insuranceLine?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodStart?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  renewalWindowDays?: number;
}
