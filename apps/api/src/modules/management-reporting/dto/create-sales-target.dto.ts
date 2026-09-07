import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * Process 59 — `POST /sales-targets` (`sales-target.manage`, Manager/
 * Executive only). Exactly one of `ownerUserId`/`branchId` is required —
 * checked in `SalesPerformanceService.createTarget` (a cross-field rule,
 * not expressible with class-validator decorators alone), re-derived
 * live against the DB `CHECK` (`SalesTarget_owner_xor_branch`) as the
 * backstop. `periodStart`/`periodEnd` are calendar dates (a target can be
 * set for a future period) parsed by `parseCalendarDate`, the
 * `Opportunity`/`Endorsement`/`BrokerLicense` shape.
 */
export class CreateSalesTargetDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  @Transform(trimIfString)
  @IsString()
  @Length(1, 60)
  periodLabel!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsInt()
  @Min(1)
  targetNewProspects!: number;
}
