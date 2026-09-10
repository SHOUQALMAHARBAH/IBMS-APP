import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Part B §33 — how far back the operational counts reach. Bounded: an
 * unbounded window is a table scan on a table that only grows. */
export class ScreeningOverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  windowDays?: number;
}
