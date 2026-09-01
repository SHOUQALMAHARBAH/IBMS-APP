import {
  IsDefined,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** The six documented-rationale dimensions the backlog enumerates. Every
 * field is required and non-blank — a recommendation must address each one,
 * not just price (the "never price alone" controls rule, Part 3.3). Length /
 * emptiness beyond the crude checks here is enforced in
 * `recommendation.config.ts`'s `normalizeRecommendationRationale` so the
 * message can name the factor. */
export class RationaleFactorsDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  coverage!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  price!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  financialStrength!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  claimsService!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  deductible!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  policyConditions!: string;
}

/** Process 16 — draft the broker recommendation for an Opportunity. The
 * Opportunity must be at `COMPARISON_BUILT` and the `recommendedQuotationId`
 * must be a current-version `Quotation` on one of its RFQs. */
export class DraftRecommendationDto {
  @IsUUID()
  opportunityId!: string;

  @IsUUID()
  recommendedQuotationId!: string;

  @IsString()
  @Transform(trimIfString)
  @MinLength(10)
  @MaxLength(8000)
  rationale!: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RationaleFactorsDto)
  rationaleFactors!: RationaleFactorsDto;
}
