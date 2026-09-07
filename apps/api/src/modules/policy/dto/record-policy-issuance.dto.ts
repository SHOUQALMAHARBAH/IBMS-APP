import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  MONEY_STRING,
  emptyStringToUndefined,
  trimIfString,
} from '../../../common/dto.util';
import { PolicyDocumentInputDto } from './policy-document-input.dto';

/** The opening coverage schedule (Part 3.4) — the requested/issued limits,
 * sums insured, named perils and extensions in force from `effectiveFrom`.
 * `limits` / `sumsInsured` are stored opaquely; their non-empty-object shape
 * is checked in `policy.config.ts` (`assertCoverageFigures`). */
export class PolicyScheduleInputDto {
  /** Defaults to the policy's inception date when omitted. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  effectiveFrom?: string;

  @IsDefined()
  @IsObject()
  limits!: Record<string, unknown>;

  @IsDefined()
  @IsObject()
  sumsInsured!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  namedPerils?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  extensions?: string[];
}

/** Process 19 — record the insurer-issued policy: its number, the issued
 * premium (from the premium invoice), an optional period correction, the
 * opening `PolicySchedule`, and the issued documents. Drives the Policy
 * `PLACEMENT_CONFIRMED -> ISSUED` transition through the workflow engine. */
export class RecordPolicyIssuanceDto {
  @IsString()
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(120)
  policyNumber!: string;

  /** The premium the insurer actually issued at (fils precision) — recorded
   * against the requested premium, the delta surfaced as `premiumVariance`. */
  @Matches(MONEY_STRING, {
    message: 'issuedPremium must be a decimal amount with at most 3 places',
  })
  issuedPremium!: string;

  /** Optional corrections the insurer confirmed at issuance. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  inceptionDate?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  expiryDate?: string;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PolicyScheduleInputDto)
  schedule!: PolicyScheduleInputDto;

  /** May be empty — a schedule can arrive before the wording PDF; attach the
   * rest later via `POST /policies/:id/documents`. */
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(50)
  @Type(() => PolicyDocumentInputDto)
  documents!: PolicyDocumentInputDto[];
}
