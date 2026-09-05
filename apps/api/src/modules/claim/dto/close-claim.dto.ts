import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Process 29 — formal claim closure.
 *
 * For a `SETTLED` claim, closure is only allowed once the client's receipt of
 * the settlement payment is confirmed. `clientPaymentConfirmedAt` supplies that
 * confirmation: a "when did this happen" instant — past-only, no earlier than
 * the loss date, and a datetime must carry an explicit offset (parsed via
 * `parseHistoricalInstant`). It is write-once on the `Settlement`; omit it once
 * already confirmed.
 *
 * A `DECLINED` claim has no payment — send no body (a `clientPaymentConfirmedAt`
 * on a declined claim is a 422).
 */
export class CloseClaimDto {
  @IsOptional()
  @IsISO8601()
  clientPaymentConfirmedAt?: string;
}
