import { IsIn, IsString, Length } from 'class-validator';
import { MODE_DECLARATION_REASON_MIN_LENGTH } from '../duty-segregation-mode.service';

/**
 * `PATCH /duty-segregation/mode`.
 *
 * The reason is MANDATORY here, unlike the per-act `combinedDutyReason` which is optional. Declaring how an
 * office separates duties is never incidental to another action — it is the whole request — so there is no
 * ordinary path that would break by requiring it.
 */
export class DeclareDutySegregationModeDto {
  @IsIn(['SEGREGATED', 'COMBINED'])
  mode!: 'SEGREGATED' | 'COMBINED';

  @IsString()
  @Length(MODE_DECLARATION_REASON_MIN_LENGTH, 2000)
  reason!: string;
}
