import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * THE OFFICE'S ACKNOWLEDGEMENT that the office-manager and data-protection-officer assignments name
 * one person.
 *
 * ## `noticeShown` IS CARRIED FROM THE CLIENT — decision 28's rule, and the owner's own text
 *
 * The sentence is the owner's, authorised the same way the `sanctions-pep.screen` description and
 * decision 28's notice were, and it lives ONCE — in the web dictionary, in both languages, which is
 * also the only place `screen-copy.test.ts` can see it. Re-deriving it at submit would answer a
 * different question from the one the record exists for: a year from now the question is WHAT THEY
 * SAW.
 *
 * ## NO `reason` FIELD, AND ITS ABSENCE IS THE DECISION
 *
 * `NoFloorDeclarationDto` beside this one carries a mandatory ten-character reason. This one
 * deliberately does not: the reason for a combined assignment is the same every time — *I am one
 * person* — so a reason box would be answered identically and become the wallpaper the owner's own
 * rule exists to prevent. An acknowledgement, and nothing else.
 */
export class CombinedAssignmentDeclarationDto {
  /**
   * Bounded generously rather than pinned to the current text's length, so that a reworded notice
   * cannot become a 400 about a field the office cannot see. The floor is high enough that an empty
   * or one-word value is refused here as well as in the service.
   */
  @IsString()
  @Transform(trimIfString)
  @Length(40, 4000)
  noticeShown!: string;

  @IsBoolean()
  @Equals(true, {
    message:
      'The acknowledgement must be ticked. Nothing here refuses the arrangement — what is recorded is that somebody read the notice, and an unticked box records nobody having read it.',
  })
  acknowledged!: boolean;
}

/**
 * `PATCH /duty-segregation/dpo-designation`.
 *
 * ## THE DESIGNATION IS A NAME, AND MAY BE CLEARED
 *
 * Decision 80: an assignment is a name and a reference, not an account and not a code bundle. An
 * empty string clears the designation — an office that has withdrawn an assignment and not yet made
 * another must be able to say so, and leaving the old name standing would be a false record of who
 * holds it.
 *
 * ## THE DECLARATION IS OPTIONAL HERE AND DECIDED IN THE SERVICE
 *
 * The same shape `CreateRetentionScheduleItemDto` uses and for the same measured reason: a DTO
 * cannot see the office-manager designation, so it cannot know whether this save creates a combined
 * assignment. Making it mandatory would demand an acknowledgement on every designation change
 * including the ordinary case where the two assignments name different people.
 *
 * And the recorded trap behind that choice: `@IsOptional()` installs a condition that SKIPS every
 * validator on its property when the value is absent, so a rule about a field's ABSENCE can never
 * live on that field. `resolveCombinedDeclaration` is where it always runs.
 */
export class RecordDpoDesignationDto {
  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @Length(0, 200)
  dataProtectionOfficerName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CombinedAssignmentDeclarationDto)
  combinedAssignmentDeclaration?: CombinedAssignmentDeclarationDto;
}
