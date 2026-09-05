import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';

/** Process 51 — `GET /compliance-calendar`. All filters optional; with
 * none, the book-wide list (capped, soonest-due first). */
export class ListComplianceCalendarQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  overdueOnly?: boolean;
}
