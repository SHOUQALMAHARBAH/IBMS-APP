import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  MONEY_STRING,
  trimIfString,
} from '../../../common/dto.util';
import { RECEIPT_METHODS } from '../finance.config';

/**
 * Process 32 — record one collection receipt against an `INVOICED` invoice.
 *
 * An invoice may be settled in INSTALMENTS: `amount` must be positive and may
 * be less than the invoice's `totalAmount`, but the running total can never
 * exceed it — an over payment is still a 422 pointing at Process 39, never a
 * silent write-off (`ibms-brain/meta/lex/money-decimal-jod.md`). The invoice
 * only walks `INVOICED -> COLLECTED` on the instalment that completes it.
 */
export class RecordReceiptDto {
  /** What the client paid on this instalment. May be less than
   * `Invoice.totalAmount`; the running total across every receipt may not
   * exceed it. */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'amount must be a decimal amount with at most 3 places',
  })
  amount!: string;

  /** How it was received. Optional. When `paymentChannelId` is also supplied,
   * `method` is derived from the channel and any conflicting value is a 422. */
  @IsOptional()
  @Transform(trimIfString)
  @IsIn([...RECEIPT_METHODS], {
    message: `method must be one of: ${RECEIPT_METHODS.join(', ')}`,
  })
  method?: string;

  /** Process 38 — the approved customer `PaymentChannel` the money came in on.
   * Optional; when set it must be an `active` channel belonging to the
   * invoice's customer, and it derives `method`. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  paymentChannelId?: string;

  /** When it was received — a past-or-now instant. Optional; defaults to now. */
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  /** The client's payment/bank reference for this instalment, and the
   * IDEMPOTENCY KEY for this endpoint (partial UNIQUE per invoice, migration
   * 20260909160000). With instalments allowed, a retried POST is otherwise
   * indistinguishable from a genuine second payment of the same amount —
   * supply a reference and the retry resumes instead of double-booking.
   * Optional: a cash collection may have none. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Length(1, 120)
  reference?: string;
}
