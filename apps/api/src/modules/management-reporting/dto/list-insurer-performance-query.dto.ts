import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 60 — `GET /insurer-performance?insurerId=&periodLabel=`
 * (`insurer-performance.view`). Both filters optional and combinable. */
export class ListInsurerPerformanceQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;
}
