import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 32 — record the net-premium remittance to the insurer against a
 * `RECONCILED` invoice. The amount (`premium − commission`) and the insurer
 * are both derived server-side — the only inputs are when the transfer
 * actually happened and, optionally, which approved channel it went out on.
 */
export class RecordRemittanceDto {
  /** When the funds were remitted — optional; defaults to now. */
  @IsOptional()
  @IsISO8601()
  remittedAt?: string;

  /** Process 38 — the approved insurer `PaymentChannel` the funds went out on.
   * Optional; when set it must be an `active` channel belonging to the policy's
   * insurer. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  paymentChannelId?: string;
}
