import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 61 — `GET /employee-performance?employeeId=&periodLabel=`
 * (`employee-performance.view`). Both filters optional and combinable. */
export class ListEmployeePerformanceQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;
}
