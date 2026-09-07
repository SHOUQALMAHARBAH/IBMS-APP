import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import {
  PAYMENT_CHANNEL_OWNER_TYPES,
  PAYMENT_CHANNEL_STATUSES,
} from '../finance.config';

/** Process 38 — `GET /payment-channels`. All filters optional; with none, the
 * book-wide channel list (newest first). */
export class ListPaymentChannelsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...PAYMENT_CHANNEL_OWNER_TYPES])
  ownerType?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...PAYMENT_CHANNEL_STATUSES])
  status?: string;
}
