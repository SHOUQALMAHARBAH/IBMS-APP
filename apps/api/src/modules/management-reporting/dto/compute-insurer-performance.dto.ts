import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * Process 60 — `POST /insurer-performance/compute` (`insurer-performance.
 * view` — no separate "manage" permission was pre-seeded for this process;
 * the same Manager/Executive audience who views the scores is trusted to
 * trigger an on-demand recompute, the `internal-controls.audit` "Run audit
 * now" precedent). Scoped to ONE insurer, required — the `up-sell-
 * recommendations/detect` shape (`DetectUpSellDto.customerId`, also
 * mandatory): a manual trigger recomputes one target, never "everybody,"
 * which stays the scheduler's own job (`InsurerPerformanceScheduler` calls
 * `InsurerPerformanceService.computeScores` directly, not through this
 * DTO/endpoint). Omit every period field for the default "score the UTC
 * calendar month that just ended" behaviour (what the monthly scheduler
 * itself does). Supply all three to recompute an explicit window — for a
 * backfill, or for an e2e test that can't wait on a real calendar month —
 * `InsurerPerformanceController` 422s a PARTIAL override (some but not all
 * three fields), since a custom range with no label to store it under (or a
 * label with no range) is incoherent.
 */
export class ComputeInsurerPerformanceDto {
  @IsUUID()
  insurerId!: string;

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
