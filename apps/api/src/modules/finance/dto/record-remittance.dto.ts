import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Process 32 — record the net-premium remittance to the insurer against a
 * `RECONCILED` invoice. The amount (`premium − commission`) and the insurer
 * are both derived server-side — the only input is when the transfer
 * actually happened.
 */
export class RecordRemittanceDto {
  /** When the funds were remitted — optional; defaults to now. */
  @IsOptional()
  @IsISO8601()
  remittedAt?: string;
}
