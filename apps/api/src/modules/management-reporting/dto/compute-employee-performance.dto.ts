import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * Process 61 — `POST /employee-performance/compute`
 * (`employee-performance.view` — no separate "manage" permission was
 * pre-seeded for this process; the `insurer-performance.view` "Run audit
 * now" precedent). Scoped to ONE employee, required — the #60 lesson
 * applied from the FIRST draft this time, not rediscovered via a
 * connection-pool timeout: a manual trigger recomputes one target, never
 * "everybody," which stays the scheduler's own job (`Employee
 * PerformanceScheduler` calls `EmployeePerformanceService.computeRecords`
 * directly, not through this DTO/endpoint). Omit every period field for the
 * default "score the UTC calendar month that just ended" behaviour;
 * supply all three to recompute an explicit window (a backfill, or an e2e
 * test that can't wait on a real calendar month) — any other combination
 * is a 422.
 */
export class ComputeEmployeePerformanceDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodStart?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodEnd?: string;
}
