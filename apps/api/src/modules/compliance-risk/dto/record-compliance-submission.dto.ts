import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 51 — `POST /compliance-calendar/:id/record-submission`
 * (`compliance-calendar.manage` / Compliance). Write-once — 409 if this
 * item's submission was already recorded. `submittedAt` defaults to now,
 * backdatable via `parseHistoricalInstant`.
 */
export class RecordComplianceSubmissionDto {
  @IsString()
  @Length(1, 500)
  evidenceOfSubmissionRef!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  submittedAt?: string;
}
