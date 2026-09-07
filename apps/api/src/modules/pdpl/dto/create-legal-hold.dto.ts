import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** M06 — `POST /legal-holds` (`legal-hold.manage`). `retentionScheduleItemId`
 * is optional — a hold not tied to a whole record category (a specific
 * customer's file under litigation) still needs a `scope` description of
 * its own; only a category-scoped hold participates in the routine-
 * disposal exclusion check (`disposal-batch.config.ts`). `nextReviewDueAt`
 * is never caller-suppliable — always computed from the 6-month
 * `legal_hold_necessity_review` SLA entry at `placedAt`.
 *
 * `customerId`/`insuredPersonId` (Process #52 widening, migration
 * `20260916120000`) structurally name the ONE data subject this hold
 * covers, independent of `retentionScheduleItemId` — at most one of the
 * two may be set (`hasAtMostOneSubjectReference`, validated in the
 * service); a hold naming neither is still valid (the pre-widening,
 * `scope`-text-only shape). Only a hold naming a subject participates in
 * `DsrService.fulfil()`'s live retention-hold check. */
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

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insuredPersonId?: string;
}
