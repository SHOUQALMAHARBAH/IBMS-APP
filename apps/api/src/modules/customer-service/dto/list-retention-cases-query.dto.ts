import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  RETENTION_CASE_REASONS,
  RETENTION_CASE_STATUSES,
} from '../retention-case.config';

/** Process 46 — `GET /retention-cases`. All filters optional; with none, the
 * book-wide list (capped, newest first). */
export class ListRetentionCasesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...RETENTION_CASE_STATUSES])
  status?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...RETENTION_CASE_REASONS])
  reason?: string;
}
