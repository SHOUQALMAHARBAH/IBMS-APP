import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Fils-precision decimal string — at most 3 decimal places (Part 3.6 /
 * ibms-brain/meta/lex/money-decimal-jod.md), same shape money.util.ts's
 * `toMoney`/`quantizeMoney` expect. No currency symbol, no thousands
 * separator: "125000" or "125000.500". */
const MONEY_STRING = /^\d{1,15}(\.\d{1,3})?$/;

/** Process 2 — Prospect Management (qualification of a Lead). Converts a
 * Lead (which must be QUALIFIED — enforced by WorkflowTransitionService, not
 * re-checked here) into a Prospect and captures the qualification profile
 * fields the backlog names verbatim: sector/activity/employee count/
 * business size/location/contact person/products of interest/expected
 * premium. */
export class CreateProspectDto {
  @IsUUID()
  leadId!: string;

  @IsString()
  @Length(1, 200)
  companyName!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  sector?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  activity?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  employeeCount?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  businessSize?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  location?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  contactPerson?: string;

  /** Free-form line names (Medical, Motor, Property, ...) — the Prospect
   * model comment lists these as examples ("e.g."), not a closed set, so
   * this is intentionally not `@IsIn()`-constrained the way Lead.source is. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  productsOfInterest?: string[];

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message:
      'expectedPremium must be a decimal string with at most 3 decimal places (fils precision), e.g. "125000.500"',
  })
  expectedPremium?: string;
}
