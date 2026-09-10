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
 *
 * `reference` is MANDATORY — see the field. With several receipts legitimately
 * allowed per invoice, it is the only thing that can tell a retry from a
 * genuine second payment of the same amount.
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

  /** The client's payment/bank/voucher reference for this instalment, and the
   * IDEMPOTENCY KEY for this endpoint (partial UNIQUE per invoice, migration
   * 20260909160000).
   *
   * MANDATORY, and that is a deliberate reversal. It was optional — "a cash
   * collection may have none" — which left the cash path with NO duplicate
   * protection at all once `Receipt.invoiceId @unique` was dropped for
   * instalments. The row lock on the parent Invoice serialises concurrent
   * writes but does not DEDUPLICATE them, and the partial UNIQUE only covers
   * `reference IS NOT NULL`. So a retried or double-clicked 400.000 cash
   * instalment against a 1,000.000 invoice recorded TWICE — two Receipts and
   * two `in` ClientFundsLedgerEntry rows, client funds overstated by 400.000,
   * no exception raised — and the client's genuine remaining 600.000 was then
   * refused as an over payment, so the invoice could never be completed
   * either. That is the P0 in IMPROVEMENTS.md §2 which migration
   * 20260909160000's own header claims to have supplied a replacement for.
   *
   * A cash collection has a teller/voucher/receipt-book number: that is a real
   * business artefact a broker already issues, not a burden invented here. */
  @Transform(trimIfString)
  @Length(1, 120, {
    message:
      'reference is required — the payment/bank/voucher reference doubles as the idempotency key that stops a retried instalment being booked twice',
  })
  reference!: string;
}
