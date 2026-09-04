import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ConsentPurpose } from '@ibms/db';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';

/** M03 — `GET /consent-records`. All filters optional; with none, the
 * book-wide list (capped, newest first). */
export class ListConsentRecordsQueryDto {
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
  @IsIn(Object.values(ConsentPurpose))
  purpose?: string;

  @IsOptional()
  @Transform(queryBoolean)
  granted?: boolean;
}
