import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** The Requested Coverage side of the Process 20 line-by-line check — what
 * the client's signed acceptance / the accepted quotation says SHOULD have
 * been issued, transcribed into the same shape as the issued `PolicySchedule`.
 * `limits` / `sumsInsured` are compared opaquely (their non-empty-object shape
 * is checked in `policy.config.ts`'s `assertCoverageFigures`). */
export class RequestedCoverageDto {
  @IsDefined()
  @IsObject()
  limits!: Record<string, unknown>;

  @IsDefined()
  @IsObject()
  sumsInsured!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  namedPerils?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  extensions?: string[];
}

/** Process 20 — record the maker/checker quality-control check of an ISSUED
 * (or re-checked DISCREPANCY) policy. The checker must not be the officer who
 * placed the cover; the system diffs this Requested Coverage against the
 * issued `PolicySchedule` and derives `discrepancyFound`. */
export class RecordPolicyCheckingDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RequestedCoverageDto)
  requestedCoverage!: RequestedCoverageDto;
}
