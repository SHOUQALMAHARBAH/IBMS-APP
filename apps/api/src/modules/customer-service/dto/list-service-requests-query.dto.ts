import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { SERVICE_REQUEST_STATUSES } from '../service-request.config';

/** Process 41 — `GET /service-requests`. All filters optional; with none, the
 * book-wide list (capped, newest first). */
export class ListServiceRequestsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...SERVICE_REQUEST_STATUSES])
  status?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  assignedToUserId?: string;
}
