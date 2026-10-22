import { IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';

/**
 * `POST /conflict-of-interest/disclosures` — decision 36.
 *
 * ## ONE FIELD, AND NO `nature` ENUM BESIDE IT
 *
 * What kinds of conflict an office recognises is not decided anywhere in this product, and shipping
 * a closed list would make the register refuse the conflict nobody anticipated. Free text, with the
 * shared declaration minimum as its floor — `common/declaration-reason.ts`, never a fourth `10`.
 *
 * ## NO `declaredByUserId` FIELD, AND THE ABSENCE IS THE CONTROL
 *
 * The subject is the authenticated caller, read from the session and never from the body — the
 * `ProvisionUserDto` precedent, where the absence of an office field is what stops a holder writing
 * into another office. A field here would let one person file a disclosure in a colleague's name,
 * which is the one thing a register of SELF-declarations must not permit.
 */
export class DeclareConflictOfInterestDto {
  @IsString()
  @Transform(trimIfString)
  @Length(DECLARATION_REASON_MIN_LENGTH, 4000)
  disclosure!: string;
}
