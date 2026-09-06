import { IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';

/** M06 — `GET /legal-holds`. All filters optional. */
export class ListLegalHoldsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  retentionScheduleItemId?: string;

  @IsOptional()
  @Transform(queryBoolean)
  active?: boolean;
}
