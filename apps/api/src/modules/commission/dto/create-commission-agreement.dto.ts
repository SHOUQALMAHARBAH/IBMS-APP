import {
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * Process 35 — `POST /commission/agreements` (`commission-rate.manage` /
 * Compliance, Manager). Opens a governed commission-rate window for an
 * (insurer, line); a still-open window for the same pair is superseded (its
 * `effectiveTo` stamped) at this window's `effectiveFrom`.
 */
export class CreateCommissionAgreementDto {
  @IsUUID()
  insurerId!: string;

  /** The insurance line the rate applies to (matched against
   * `Policy.insuranceLine`, which is free text). */
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(200)
  insuranceLine!: string;

  /** The commission rate, `0..100`, at most 2 decimal places (`"12.50"`). */
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, {
    message:
      'ratePercent must be a percentage with at most 2 decimal places, e.g. "12.50"',
  })
  ratePercent!: string;

  /** Process 36 — the governed VAT rate on the broker's commission income for
   * this pair, `0..100`, at most 2 decimal places. Optional; defaults to `0`
   * (no VAT applied until a rate manager sets a figure). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{1,3}(\.\d{1,2})?$/, {
    message:
      'vatRatePercent must be a percentage with at most 2 decimal places, e.g. "16.00"',
  })
  vatRatePercent?: string;

  /** When the rate takes effect — a plain `YYYY-MM-DD`. Optional; defaults to
   * now. May be future-dated (a scheduled rate change); must not predate the
   * window it supersedes. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveFrom must be a calendar date in YYYY-MM-DD form',
  })
  effectiveFrom?: string;
}
