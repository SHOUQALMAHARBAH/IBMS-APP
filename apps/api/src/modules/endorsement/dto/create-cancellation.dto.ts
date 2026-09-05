import {
  IsIn,
  IsISO8601,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { CANCELLATION_BASES } from '../endorsement.config';

const BASES = [...CANCELLATION_BASES];

/** Process 22 — raise a cancellation. Implemented as a NEGATIVE endorsement
 * (`changeType: cancellation`); the return premium is **computed** from the
 * basis, not supplied. */
export class CreateCancellationDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;

  @IsIn(BASES, { message: `basis must be one of: ${BASES.join(', ')}` })
  basis!: (typeof BASES)[number];

  /** When cover ceases. */
  @IsISO8601()
  effectiveFrom!: string;
}
