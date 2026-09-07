import { IsISO8601, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 21 — record the client's confirmation that they received the
 * policy. Stamps `DeliveryRecord.receiptAcknowledgedAt` and best-effort
 * advances `Policy DELIVERED → ACTIVE`. */
export class AcknowledgeReceiptDto {
  /** When the client acknowledged receipt. Defaults to now; not in the
   * future, a datetime must carry an explicit offset. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  acknowledgedAt?: string;
}
