import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * Part B §6 — rolling back to an earlier list generation.
 *
 * The reason is MANDATORY, with a real minimum length. A rollback means a
 * person has decided the newest available sanctions list should NOT be the one
 * screening runs against — the most consequential manual override in this
 * module. "Rolled back" with no stated basis is indistinguishable from an
 * accident, and this text is what a regulator asks to see. Same reasoning as
 * the mandatory reason on a screening match review, and the database enforces
 * it too (`WatchlistDatasetVersion_rollback_has_reason`).
 */
export class RollbackDatasetDto {
  @Transform(trimIfString)
  @IsString()
  @Length(10, 2000, {
    message:
      'reason must explain why an older list is being restored (at least 10 characters)',
  })
  reason!: string;
}
