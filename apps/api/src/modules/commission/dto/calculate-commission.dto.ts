import { IsUUID } from 'class-validator';

/** Process 35 — `POST /commission/entries` (`commission.calculate` /
 * Finance). Records the one new-business `CommissionLedgerEntry` for a policy
 * at the governed rate in force for its (insurer, line) at inception. */
export class CalculateCommissionDto {
  @IsUUID()
  policyId!: string;
}
