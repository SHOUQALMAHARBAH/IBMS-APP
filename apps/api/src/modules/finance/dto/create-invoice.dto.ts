import { IsOptional, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';

/** A calendar date, `YYYY-MM-DD`, no time component. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Process 31 — raise a premium invoice against a policy.
 *
 * The customer, the `premiumAmount` (carried from `Policy.issuedPremium`) and
 * the `commissionDeducted` (`premium x` the placed commission rate) are all
 * server-derived — never accepted here. `totalAmount` is computed
 * (`premium + tax + fees - commissionDeducted`). The only inputs are the
 * policy, the applicable tax, the broker fees, and the due date.
 */
export class CreateInvoiceDto {
  /** The issued policy to bill. Must have an `issuedPremium` (422 otherwise). */
  @IsUUID()
  policyId!: string;

  /** The applicable premium tax. `>= 0`, `<= premiumAmount`. Finance supplies
   * this (there is no governed tax-rate table yet — see
   * ibms-brain/meta/context/finance-lifecycle.md). */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'taxAmount must be a decimal amount with at most 3 places',
  })
  taxAmount!: string;

  /** Broker / issuance fees. `>= 0`, `<= premiumAmount`. Defaults to `0`. */
  @IsOptional()
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'feesAmount must be a decimal amount with at most 3 places',
  })
  feesAmount?: string;

  /** When payment is due — a calendar date, today or later, at most a year
   * ahead. */
  @Transform(trimIfString)
  @Matches(DATE_ONLY, {
    message: 'dueDate must be a calendar date, YYYY-MM-DD',
  })
  dueDate!: string;
}
