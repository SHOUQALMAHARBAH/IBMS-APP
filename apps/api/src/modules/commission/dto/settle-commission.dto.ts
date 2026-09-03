import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';

/**
 * Process 36 — `POST /commission/entries/:id/settle` (`commission.reconcile` /
 * Finance). Reconciles the entry against an insurer commission statement and
 * marks it `paid`. `statementAmount` MUST equal the recorded commission
 * `amount` exactly — a variance is a Process 39 reconciliation exception,
 * never a silent short settle.
 */
export class SettleCommissionDto {
  /** The commission figure on the insurer's statement — must equal the
   * recorded `amount`. Fils-precision decimal string. */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'statementAmount must be a decimal amount with at most 3 places',
  })
  statementAmount!: string;

  /** The insurer statement / payment reference — a pointer stored on the
   * entry, not free text. */
  @Transform(trimIfString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  paymentReference!: string;
}
