import { Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
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
   * trail and required before the override can be approved. */
  @Transform(trimIfString)
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
