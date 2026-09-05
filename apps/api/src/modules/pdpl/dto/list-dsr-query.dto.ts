import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { DsrStatus } from '@ibms/db';
import { DSR_TYPES } from '../dsr.config';

const DSR_STATUSES = Object.values(DsrStatus);

/** M04 — `GET /dsr`. All filters optional; with none, the book-wide list
 * (capped, newest first). */
export class ListDsrQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insuredPersonId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(DSR_STATUSES)
  status?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(DSR_TYPES)
  type?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  dpoHandlerUserId?: string;
}
