import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * Process 59 — `GET /sales-performance?ownerUserId=&branchId=&periodLabel=`
 * (`dashboard.sales.view`). A Sales/Relationship Officer is forced to their
 * own `ownerUserId` regardless of what's passed here (the `lead.service.ts`
 * `VIEW_ALL_OWNERS_ROLES` shape) — Manager/Executive may pass either
 * `ownerUserId` OR `branchId` (`SalesPerformanceService.resolveScope`
 * 422s on both or neither). `periodLabel` omitted resolves the target
 * whose window contains "now" for that scope; given, it looks up that
 * exact target by scope + label (404 if none exists).
 */
export class SalesPerformanceQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;
}
