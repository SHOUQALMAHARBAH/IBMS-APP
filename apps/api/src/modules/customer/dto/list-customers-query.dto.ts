import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

export class ListCustomersQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(CustomerStatus))
  status?: CustomerStatus;

  /** Part F item #6 — bilingual full-text search over legalName.
   * `emptyStringToUndefined` matters here: an empty search box must mean
   * "no filter" (show everything), not "search for an empty string" (which
   * matches nothing — verified empirically). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;
}
