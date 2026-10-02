import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * LAYER 1's two bodies: asking whether this person already exists, and recording that the answer
 * stopped somebody creating a duplicate.
 *
 * ## There is no three-character floor here, and that is deliberate
 *
 * `SearchCustomersDto` floors at three because it COMPLETES names — an officer types a fragment and the
 * route must not answer with the book. This one takes a name the officer has already finished typing and
 * asks an EXACT question of it: does the ordered canonical key of this whole name match an existing one?
 *
 * The distinction is not stylistic. A prefix search on two characters returns a slice of the register;
 * an exact canonical-key match on two characters returns the customers actually named those two
 * characters, which is the answer to the question asked. Borrowing the search's floor would have refused
 * a real two-character name — and a person entering one would then get no warning at all, which is the
 * one outcome this field exists to prevent.
 *
 * What it does carry is the same bound on results (`DUPLICATE_NAME_MATCH_LIMIT`) and the same refusal of
 * an empty query, because those two conditions are about not becoming a directory and apply to any route
 * that answers with customers.
 */
export class CheckDuplicateNameDto {
  @Transform(trimIfString)
  @IsString()
  @MinLength(1, {
    message:
      'legalName must not be empty — there is no "warn me about everybody" mode',
  })
  @MaxLength(200)
  legalName!: string;
}

/**
 * THE ABANDONED CREATE — the outcome the warning exists to produce.
 *
 * Sent when the officer is shown matches and answers "yes, this is the same person", so no customer is
 * written. There is no customer id in this body because there is no customer, and that absence is the
 * finding rather than a missing field: see `DuplicateNameWarning.createdCustomerId`, which is nullable
 * for exactly this case and whose migration refuses a NOT NULL.
 */
export class RecordAbandonedDuplicateDto {
  @Transform(trimIfString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  legalName!: string;

  /**
   * How many matches the officer was shown. Carried from the client rather than re-counted here, because
   * the measurement is about what the person SAW — a colleague creating another match in between would
   * otherwise silently rewrite the number they were told.
   */
  @IsInt()
  @Min(1, {
    message:
      'matchCount must be at least 1 — a warning with no matches behind it was never shown to anybody',
  })
  matchCount!: number;
}
