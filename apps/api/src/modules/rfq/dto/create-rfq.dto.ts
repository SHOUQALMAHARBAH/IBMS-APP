import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Process 11 — create one RFQ for one insurance line under an Opportunity
 * and send it to a shortlist of insurers. Each shortlisted insurer becomes a
 * SENT `RFQInsurer` row. `followUpThresholdDays` overrides the column
 * default (9) for this RFQ's follow-up sweep; omit to take the default. */
export class CreateRfqDto {
  @IsUUID()
  opportunityId!: string;

  @Transform(trimIfString)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  insuranceLine!: string;

  /** The insurer shortlist. At least one, de-duplicated server-side; every
   * id must resolve to a real Insurer (422 otherwise). */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  insurerIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  followUpThresholdDays?: number;
}
