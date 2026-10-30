import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { NoFloorDeclarationDto } from './no-floor-declaration.dto';

/** M06 — `PATCH /retention-schedule/:id` (`retention-schedule.manage`).
 * Blocked once `confirmedByLegalCounselAt` is set — see
 * `RetentionScheduleService.update`'s own guard. Does not accept
 * `recordCategory` — renaming a category is a new row, not an edit of an
 * existing one's identity. */
export class UpdateRetentionScheduleItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  retentionPeriodMonths?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  legalBasis?: string;

  /** See the create DTO: optional here, decided in the service, because a DTO cannot see the floor. */
  @IsOptional()
  @ValidateNested()
  @Type(() => NoFloorDeclarationDto)
  noFloorDeclaration?: NoFloorDeclarationDto;
}
