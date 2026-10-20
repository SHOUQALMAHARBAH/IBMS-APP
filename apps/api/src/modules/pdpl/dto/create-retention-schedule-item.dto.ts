import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { NoFloorDeclarationDto } from './no-floor-declaration.dto';

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

  /**
   * OPTIONAL HERE AND REQUIRED IN THE SERVICE, which is the same shape `CombinedDutyDeclarationDto`
   * uses and for the same reason: a DTO cannot see whether this category has a known floor, and
   * making it mandatory would demand a declaration on every save including the two families that
   * already refuse or accept on their own. `resolveNoFloorDeclaration` decides.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => NoFloorDeclarationDto)
  noFloorDeclaration?: NoFloorDeclarationDto;
}
