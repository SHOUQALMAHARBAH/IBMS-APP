import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/** Up to 15 integer digits + up to 3 decimal places — the Decimal(18,3)
 * money shape used across the codebase. */
const MONEY = /^\d{1,15}(\.\d{1,3})?$/;

/**
 * Process 28 — record a claim settlement's four distinct figures. `estimatedLoss`
 * is carried from the `Claim` (not re-typed); `netSettlement` is computed
 * (`approvedAmount - deductible`), never accepted here. The officer who posts
 * this is recorded as the first approver (`Settlement.approvedByUserId`).
 */
export class RecordSettlementDto {
  /** The insurer's approved figure. `> 0`, `<= Claim.estimatedLoss`. */
  @IsString()
  @Transform(trimIfString)
  @Matches(MONEY, {
    message:
      'approvedAmount must be a positive amount with up to 3 decimal places',
  })
  approvedAmount!: string;

  /** The policy deductible applied. `>= 0`, `<= approvedAmount` (net can't go
   * negative). */
  @IsString()
  @Transform(trimIfString)
  @Matches(MONEY, {
    message: 'deductible must be an amount with up to 3 decimal places',
  })
  deductible!: string;

  /** True when the broker (not the insurer direct) processes the payout —
   * forces a mandatory second approver regardless of amount. */
  @IsOptional()
  @IsBoolean()
  brokerProcessedPayment?: boolean;
}
