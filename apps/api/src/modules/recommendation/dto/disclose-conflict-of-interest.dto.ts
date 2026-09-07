import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/** Process 16 — record the mandatory conflict-of-interest disclosure for a
 * recommendation the system flagged (`conflictOfInterestFlagged`). Without
 * this row, `POST /recommendations/:id/send` refuses to send. */
export class DiscloseConflictOfInterestDto {
  /** The competing quotation being disclosed against. Optional — defaults to
   * the one the draft-time heuristic identified (`coiCompetingQuotationId`).
   * If given, must be a current-version quotation on the same Opportunity,
   * and not the recommended one. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  competingQuotationId?: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(20)
  @MaxLength(8000)
  disclosureText!: string;
}
