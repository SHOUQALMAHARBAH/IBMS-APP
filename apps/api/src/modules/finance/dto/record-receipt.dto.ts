import { IsIn, IsISO8601, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';
import { RECEIPT_METHODS } from '../finance.config';

/**
 * Process 32 — record the client's collection receipt against an `INVOICED`
 * invoice. `amount` must equal the invoice's `totalAmount` exactly — a partial
 * or over payment is a 422 (the variance path is Process 39, never a silent
 * write-off — `ibms-brain/meta/lex/money-decimal-jod.md`). Records at most one
 * receipt per invoice.
 */
export class RecordReceiptDto {
  /** What the client paid — must equal `Invoice.totalAmount`. */
  @Transform(trimIfString)
  @Matches(MONEY_STRING, {
    message: 'amount must be a decimal amount with at most 3 places',
  })
  amount!: string;

  /** How it was received. Optional. */
  @IsOptional()
  @Transform(trimIfString)
  @IsIn([...RECEIPT_METHODS], {
    message: `method must be one of: ${RECEIPT_METHODS.join(', ')}`,
  })
  method?: string;

  /** When it was received — a past-or-now instant. Optional; defaults to now. */
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
}
