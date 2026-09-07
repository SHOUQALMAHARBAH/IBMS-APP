import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Process 26 — stamp the loss adjuster's survey and / or investigation
 * completion. At least one field must be present (enforced in the service).
 * Each value is a "when did this happen" instant: past-only, and a datetime
 * must carry an explicit offset (parsed via `parseHistoricalInstant`).
 */
export class RecordAdjusterProgressDto {
  @IsOptional()
  @IsISO8601()
  surveyCompletedAt?: string;

  @IsOptional()
  @IsISO8601()
  investigationCompletedAt?: string;
}
