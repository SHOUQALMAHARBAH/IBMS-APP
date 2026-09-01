import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, MONEY_STRING } from '../../../common/dto.util';
import {
  MAX_BI_PERIOD_MONTHS,
  MIN_BI_PERIOD_MONTHS,
} from '../quotation.config';

/** The quote terms an insurer sends — shared by `POST /quotations`
 * (capture, a version-1 row) and `POST /quotations/:id/revise` (a new
 * version). Every monetary field is a fils-precision decimal string
 * (`MONEY_STRING`), quantized + range-checked in `quotation.config.ts`'s
 * `normalizeQuotationTerms`; `premium` is the only required one. `limits`
 * is a free-form coverage-limits object (e.g. per-occurrence / aggregate) —
 * stored as opaque JSON, its internal shape is not validated here
 * (README § Known gaps, Part C #13). */
export class QuotationTermsDto {
  @Matches(MONEY_STRING, {
    message:
      'premium must be a decimal string with at most 3 decimal places (fils precision), e.g. "125000.500"',
  })
  premium!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter code, e.g. "JOD"',
  })
  currency?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message:
      'deductible must be a decimal string with at most 3 decimal places (fils precision)',
  })
  deductible?: string;

  @IsOptional()
  @IsObject()
  limits?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(MIN_BI_PERIOD_MONTHS)
  @Max(MAX_BI_PERIOD_MONTHS)
  biPeriodMonths?: number;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message:
      'liabilityLimit must be a decimal string with at most 3 decimal places (fils precision)',
  })
  liabilityLimit?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(4000)
  exclusions?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(4000)
  conditions?: string;

  /** The commission rate the insurer quoted, as a percentage string
   * (`"12.5"`), 0..100, at most 2 decimal places. Captured verbatim —
   * applying it to a premium is Finance's job (#31+). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, {
    message:
      'commissionRatePercent must be a percentage with at most 2 decimal places, e.g. "12.50"',
  })
  commissionRatePercent?: string;
}
