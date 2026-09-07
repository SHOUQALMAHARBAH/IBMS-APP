import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';

/** M06 — `GET /legal-holds`. All filters optional. `customerId`/
 * `insuredPersonId` (Process #52 widening) let a DPO find which hold(s), if
 * any, cover a given data subject — the same query `DsrService.fulfil()`
 * runs internally, exposed here for a human to verify before/after a
 * blocked Deletion request. */
export class ListLegalHoldsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  retentionScheduleItemId?: string;

  @IsOptional()
  @Transform(queryBoolean)
  active?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insuredPersonId?: string;
}
