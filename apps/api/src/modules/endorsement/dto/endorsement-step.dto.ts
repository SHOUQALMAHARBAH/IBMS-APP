import { IsISO8601, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { MONEY_STRING, emptyStringToUndefined } from '../../../common/dto.util';

/** `POST /endorsements/:id/advance` — walk one hop of the pre-financial
 * lifecycle (`REQUESTED → SUBMITTED_TO_INSURER → INSURER_CONFIRMED`). The
 * optional `occurredAt` backdates the milestone timestamp. */
export class AdvanceEndorsementDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  occurredAt?: string;
}

/** `POST /endorsements/:id/calculate-adjustment` — finalise the money
 * (`INSURER_CONFIRMED → FINANCIAL_ADJUSTMENT_CALCULATED`). An optional
 * `premiumAmount` overrides the request-time figure with what the insurer
 * finally confirmed — accepted only on the FIRST call (from
 * `INSURER_CONFIRMED`); a different value supplied on a later re-call (once the
 * Refund + CommissionReversal have been minted from it) is a `422`, not a
 * silent no-op. Ignored for a cancellation, whose return premium is computed
 * from the basis. */
export class CalculateAdjustmentDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(MONEY_STRING, {
    message: 'premiumAmount must be a decimal amount with at most 3 places',
  })
  premiumAmount?: string;
}
