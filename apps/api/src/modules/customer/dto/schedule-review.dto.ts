import { IsISO8601, IsOptional } from 'class-validator';

/** Process 3-4 — "Schedule periodic re-KYC by risk classification"
 * (kyc.review.schedule). `nextReviewDueAt` overrides the risk-based default
 * KycService.approve() already computes; omit it to just recompute that
 * default from the current RiskRating instead. */
export class ScheduleReviewDto {
  @IsOptional()
  @IsISO8601()
  nextReviewDueAt?: string;
}
