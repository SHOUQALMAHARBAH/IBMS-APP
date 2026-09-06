import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** M06 — `POST /legal-holds` (`legal-hold.manage`). `retentionScheduleItemId`
 * is optional — a hold not tied to a whole record category (a specific
 * customer's file under litigation) still needs a `scope` description of
 * its own; only a category-scoped hold participates in the routine-
 * disposal exclusion check (`disposal-batch.config.ts`). `nextReviewDueAt`
 * is never caller-suppliable — always computed from the 6-month
 * `legal_hold_necessity_review` SLA entry at `placedAt`. */
export class CreateLegalHoldDto {
  @IsString()
  @Length(1, 500)
  scope!: string;

  @IsString()
  @Length(1, 2000)
  reason!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  retentionScheduleItemId?: string;
}
