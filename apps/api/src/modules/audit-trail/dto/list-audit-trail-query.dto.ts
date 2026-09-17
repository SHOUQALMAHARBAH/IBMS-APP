import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { AUDIT_ACTIONS } from '../audit-trail.config';

/**
 * Process 57 — `GET /audit-trail?entityType=&entityId=&userId=&action=
 * &from=&to=` (`audit-log.read`). Every filter is optional; omitting all of
 * them browses the whole log a page at a time, newest-first.
 */
export class ListAuditTrailQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  entityType?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  entityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  userId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(AUDIT_ACTIONS)
  action?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  from?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  to?: string;

  /** 0-based; out-of-range values are clamped rather than rejected — see
   *  `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;
}
