import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { DisposalBatchStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** M06 — `GET /disposal-batches`. All filters optional. */
export class ListDisposalBatchesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  retentionScheduleItemId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(DisposalBatchStatus))
  status?: DisposalBatchStatus;
}
