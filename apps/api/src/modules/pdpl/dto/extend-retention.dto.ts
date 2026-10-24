import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';
import {
  EXTENSION_BASES,
  EXTENSION_NOTE_MIN_LENGTH,
  type ExtensionBasis,
} from '../retention-extension.config';

/**
 * `POST /retention-notices/extend` (`retention.extend`).
 *
 * THE BASIS IS AN ENUM, NOT A STRING — the whole point of item C. A text box accepts a sentence
 * that is not a basis at all, and the adviser's position is that extending without legislative
 * cover or the customer's consent "carries high legal risk". `@IsIn(EXTENSION_BASES)` makes a
 * fourth basis a 400 at the boundary rather than a judgement in a service.
 *
 * THE PER-BASIS REQUIREMENTS ARE NOT DECORATORS, deliberately. Which fields a basis needs depends on
 * WHICH basis it is, and a conditional `@ValidateIf` per field would scatter one rule across six
 * declarations. `assertExtensionBasis` holds it in one place, and the database's
 * `RetentionExtension_basis_substantiated` CHECK is the backstop — so an unsubstantiated row is
 * unrepresentable rather than merely rejected.
 */
export class ExtendRetentionDto {
  @IsString()
  @Length(1, 200)
  recordCategory!: string;

  /**
   * The records this extension covers. Named rather than implied: the register has to say WHICH
   * records were extended, and "all of them" is not an answer a year later.
   *
   * Bounded at 500 — a bulk extension is a real act an office takes on a notice listing many files,
   * and an unbounded array is a request that writes an unbounded number of rows.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  recordIds!: string[];

  /** How long. One month minimum; a hundred years is the ceiling a typo cannot cross. */
  @IsInt()
  @Min(1)
  @Max(1200)
  months!: number;

  @IsIn(EXTENSION_BASES)
  basis!: ExtensionBasis;

  /** Accompanies the basis; never replaces it. Ten characters, the shared declaration minimum. */
  @IsString()
  @Transform(trimIfString)
  @Length(EXTENSION_NOTE_MIN_LENGTH, 2000)
  note!: string;

  @IsOptional()
  @Transform(trimIfString)
  @IsString()
  @Length(1, 300)
  instrument?: string;

  @IsOptional()
  @Transform(trimIfString)
  @IsString()
  @Length(1, 100)
  article?: string;

  /** A reference to a HOLD ROW, not a description of one — so the basis points at a stored fact. */
  @IsOptional()
  @IsUUID()
  legalHoldId?: string;

  @IsOptional()
  @IsUUID()
  consentRecordId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @IsString()
  @Length(1, 200)
  consentDuration?: string;

  @IsOptional()
  @Transform(trimIfString)
  @IsString()
  @Length(1, 300)
  consentPurpose?: string;
}
