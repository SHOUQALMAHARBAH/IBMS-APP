import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { COMPLAINT_STATUSES } from '../complaint.config';

/** Process 42 — `GET /complaints`. All filters optional; with none, the
 * book-wide list (capped, newest first). */
export class ListComplaintsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...COMPLAINT_STATUSES])
  status?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  claimId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  responsibleEmployeeUserId?: string;
}
