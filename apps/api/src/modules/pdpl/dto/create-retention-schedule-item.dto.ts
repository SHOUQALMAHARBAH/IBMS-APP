import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * M06 — `POST /retention-schedule` (`retention-schedule.manage`). One row
 * per record category — `recordCategory` is a real unique constraint, so a
 * duplicate is a 409, not a silent second row. `legalBasis` should cite
 * `PRIV-STD-03` / the specific CBJ or AML article once a real figure
 * exists; a caller with no citation yet may still create a DRAFT row (the
 * `AuditLogEntry` seed precedent) — confirmation, not creation, is the
 * gate that gets stricter.
 */
export class CreateRetentionScheduleItemDto {
  @IsString()
  @Length(1, 200)
  recordCategory!: string;

  @IsInt()
  @Min(1)
  retentionPeriodMonths!: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  legalBasis?: string;
}
