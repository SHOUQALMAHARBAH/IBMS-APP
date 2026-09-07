import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * `GET /dashboards/sales` (`dashboard.sales.view`). Every filter is
 * optional and independently applicable only where the underlying metric
 * has that dimension — see `sales-dashboard.config.ts`'s header comment.
 * `periodLabel`/`periodStart`/`periodEnd` follow the #60/#61 all-or-none
 * shape: omit all three for the previous UTC calendar month, or supply all
 * three for an explicit window (422 on a partial override).
 */
export class SalesDashboardQueryDto {
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
}
