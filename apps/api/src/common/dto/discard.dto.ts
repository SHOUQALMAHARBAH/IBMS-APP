import { IsString, Length } from 'class-validator';
import { DISCARD_REASON_MIN_LENGTH } from '../discard.config';

/**
 * The body of every discard route, shared by all four entities.
 *
 * One DTO rather than four identical ones: the reason's floor is a property of what a discard IS, not of
 * which record is being discarded, and four copies is four places for the minimum to drift.
 *
 * The length is validated here AND in `assertDiscardable` AND by a CHECK constraint per table. That is not
 * redundancy for its own sake — the DTO gives a 400 naming the field, the service gives a 422 explaining
 * what the reason is for, and the constraint means a caller bypassing application code entirely still cannot
 * write a discard nobody can read.
 */
export class DiscardDto {
  @IsString()
  @Length(DISCARD_REASON_MIN_LENGTH, 2000)
  reason!: string;
}
