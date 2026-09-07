import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

export class ClaimsDashboardQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  insuranceLine?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  /** The reference date the snapshot is "as of" — `YYYY-MM-DD`, today or
   * earlier. Default: today (see `client-accounting.md` #33's own `asOf`). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  asOf?: string;
}
