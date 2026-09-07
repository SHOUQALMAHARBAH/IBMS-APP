import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 72-73 — `PATCH /bcp-dr-plans/:id` (`bcp-dr.manage`). `scenario`
 * is immutable once created — a plan is FOR one scenario; reclassifying it
 * would just be a new plan. */
export class UpdateBcpDrPlanDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  planDocumentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  rtoHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rpoHours?: number;
}
