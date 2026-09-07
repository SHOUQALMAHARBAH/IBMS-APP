import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** A 0-100 score string, at most 2 decimal places — the `Decimal(5, 2)`
 * columns. Range + "insurer must have a current quote" are enforced in
 * `comparison.config.ts`, not here, so the message can explain. */
const SCORE_STRING = /^\d{1,3}(\.\d{1,2})?$/;

/** One insurer's optional subjective scores, supplied by Placement on the
 * build request (there is no Insurer-scoring module — narrative Process
 * 61). Both scores are optional; an entry with neither is pointless but
 * harmless. */
export class InsurerScoreDto {
  @IsUUID()
  insurerId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(SCORE_STRING, {
    message:
      'insurerQualityScore must be a 0-100 number with at most 2 decimal places',
  })
  insurerQualityScore?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(SCORE_STRING, {
    message:
      'serviceScore must be a 0-100 number with at most 2 decimal places',
  })
  serviceScore?: string;
}

/** Process 14 — build (or rebuild) the quote comparison matrix for one RFQ.
 * The rows are assembled automatically from every current-version
 * `Quotation` on the RFQ; `scores` optionally attaches the two subjective
 * dimensions per insurer (each `insurerId` must have a current quote — 422
 * otherwise). */
export class BuildComparisonDto {
  @IsUUID()
  rfqId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => InsurerScoreDto)
  scores?: InsurerScoreDto[];
}
