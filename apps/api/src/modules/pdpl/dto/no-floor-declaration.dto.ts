import { Equals, IsBoolean, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { NO_FLOOR_REASON_MIN_LENGTH } from '../retention-floors.config';

/**
 * THE OFFICE'S DECLARATION for a record category this system knows no statutory minimum for.
 *
 * Batch 5 group 6, the owner's ruling: the harm is the office's OWN regulatory exposure, so the
 * save is ACCEPTED and what is added is a declaration — the sentence it was shown, a written
 * reason, and an acknowledgement ticked by hand.
 *
 * ## `noticeShown` IS CARRIED FROM THE CLIENT, DELIBERATELY
 *
 * The `DuplicateNameWarning` precedent and its exact reasoning: that record stores "the match count
 * the officer actually SAW, carried from the client, because re-deriving it at submit would
 * silently rewrite what they were told". The same applies with more force here, because the thing
 * being recorded is a legal notice: a year from now the question is WHAT THEY SAW, and a sentence
 * re-derived at submit answers a different question.
 *
 * So the server does not hold a second copy of the text. The sentence lives once, in the web
 * dictionary, in both languages — which is also where `screen-copy.test.ts` can see it.
 *
 * ## `acknowledged` MUST BE LITERALLY `true`
 *
 * `@Equals(true)` rather than `@IsBoolean()` alone: a client sending `false` is a client that
 * rendered the box and had it left unticked, and accepting that would make the acknowledgement a
 * field rather than an act. The box is not pre-ticked and has no default — asserted on the screen.
 */
export class NoFloorDeclarationDto {
  /**
   * The sentence the office was shown, verbatim as rendered. Bounded generously rather than pinned
   * to the current text's length: a reworded notice must not become a 400 about a field the office
   * cannot see, and the one thing that matters is that SOMETHING real was displayed.
   */
  @IsString()
  @Transform(trimIfString)
  @Length(40, 4000)
  noticeShown!: string;

  /** Ten characters, the established declaration minimum — one home for that number. */
  @IsString()
  @Transform(trimIfString)
  @Length(NO_FLOOR_REASON_MIN_LENGTH, 2000)
  reason!: string;

  @IsBoolean()
  @Equals(true, {
    message:
      'The acknowledgement must be ticked. A declaration nobody confirmed reading is the box-ticking the owner ruled out.',
  })
  acknowledged!: boolean;
}
