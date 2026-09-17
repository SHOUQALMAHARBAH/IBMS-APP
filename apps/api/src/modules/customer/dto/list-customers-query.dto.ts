import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

export class ListCustomersQueryDto {
  /** 0-based. Out-of-range values are clamped rather than rejected — see
   *  `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;

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
