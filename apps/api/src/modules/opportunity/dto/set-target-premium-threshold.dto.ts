import { Matches, ValidateIf } from 'class-validator';
import { MONEY_STRING } from '../../../common/dto.util';

/** Process 16 — set (or clear) the Opportunity's configurable senior-officer
 * approval threshold. The field is required in the body: `null` clears the
 * threshold, a decimal string sets it (fils precision — `@db.Decimal(18, 3)`).
 * A recommended quote whose premium exceeds this needs `recommendation.approve`
 * before it can be sent to the client. */
export class SetTargetPremiumThresholdDto {
  /** `null` (clear the threshold) or a fils-precision decimal string.
   * `@ValidateIf` skips the regex only for an explicit `null`; an omitted
   * field fails the regex, so the caller must be explicit. */
  @ValidateIf((_, value) => value !== null)
  @Matches(MONEY_STRING, {
    message:
      'targetPremiumThreshold must be null or a decimal string with at most 3 decimal places (fils precision), e.g. "250000.000"',
  })
  targetPremiumThreshold!: string | null;
}
