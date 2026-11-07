import { Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';

/**
 * Process 35 — `POST /commission/entries/:id/override` (`commission-override
 * .raise` / Finance). Proposes a manual commission amount; `reason` is
 * mandatory (Part 5.2 — the manual override requires a logged reason). The
 * proposal is not effective until a distinct `commission-override.approve`
 * holder approves it.
 */
export class RaiseCommissionOverrideDto {
  /** The proposed commission amount, `0 ≤ x ≤ Policy.issuedPremium`. */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'overrideAmount must be a decimal amount with at most 3 places',
  })
  overrideAmount!: string;

  /** Why the governed rate is being overridden — logged verbatim on the audit
   * trail and required before the override can be approved.
   *
   * THE FLOOR COMES FROM `common/declaration-reason.ts` AND IS NOT WRITTEN AGAIN HERE.
   * That file calls itself the one home for a declaration's minimum reason length and
   * names exactly two sites as its evidence — `COMBINED_DUTY_REASON_MIN_LENGTH` and *"the
   * commission override's `reason`"*, which is this field. It was a literal `10` until
   * 2026-11-07, so the file that exists to stop a third `10` being written cited, as proof
   * of its own rule, a site that was a second one. Found by
   * `scripts/measurements/declaration-floor-fit.py`, which now gates it. */
  @Transform(trimIfString)
  @MinLength(DECLARATION_REASON_MIN_LENGTH)
  @MaxLength(2000)
  reason!: string;
}
