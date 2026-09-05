import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { DELIVERY_METHODS } from '../policy-delivery.config';

/** Process 21 — record that the issued policy document was delivered to the
 * client. The `Policy` must be `VERIFIED` (past Process 20 checking); one
 * `DeliveryRecord` per policy. Drives `Policy VERIFIED → DELIVERED`. */
export class RecordPolicyDeliveryDto {
  @IsIn(DELIVERY_METHODS, {
    message: `method must be one of: ${DELIVERY_METHODS.join(', ')}`,
  })
  method!: (typeof DELIVERY_METHODS)[number];

  /** Who it was delivered to — a name, an email address, or a courier
   * reference. */
  @IsString()
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(200)
  recipient!: string;

  /** When it was delivered. Defaults to now; a backdated value must not be in
   * the future and a datetime must carry an explicit offset (see
   * `parseHistoricalInstant`). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  deliveredAt?: string;
}
