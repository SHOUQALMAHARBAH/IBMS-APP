import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 59 — `GET /sales-targets?ownerUserId=&branchId=` (`sales-target.
 * manage`, the raw registry browse — a Manager auditing what quotas exist,
 * distinct from the resolved performance-vs-target read at
 * `GET /sales-performance`). Both filters are optional and may be combined
 * with neither, unlike `CreateSalesTargetDto` — a browse is allowed to be
 * unscoped; only a create's row shape must pick exactly one. */
export class ListSalesTargetQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;
}
