import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/** Process 35 — `GET /commission/agreements`. Both filters optional; with
 * neither, the full rate table (all pairs, newest window first per line). */
export class ListCommissionAgreementsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  insuranceLine?: string;
}
