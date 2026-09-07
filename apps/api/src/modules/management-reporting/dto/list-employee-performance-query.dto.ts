import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 61 — `GET /employee-performance?employeeId=&periodLabel=&branchId=`
 * (`employee-performance.view`). All filters optional and combinable.
 * `branchId` is a Part E Insurer & Employee Performance Dashboard (backlog
 * #64) addition — scopes to employees whose linked `User.branchId` matches. */
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

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;
}
