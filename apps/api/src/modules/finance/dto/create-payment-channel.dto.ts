import {
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import {
  ACCOUNT_LAST4,
  PAYMENT_CHANNEL_OWNER_TYPES,
  RECEIPT_METHODS,
} from '../finance.config';

/**
 * Process 38 — `POST /payment-channels` (`payment-channel.manage` / Finance).
 * Records an approved payment channel for a customer (money IN) or an insurer
 * (money OUT). Exactly one of `customerId` / `insurerId` is supplied and it
 * must match `ownerType`. **Masked-only** — the DTO has no full account-number
 * field; `accountLast4` (2–4 digits) is the only bank fragment accepted
 * (`sensitive-data-handling.md`).
 */
export class CreatePaymentChannelDto {
  @IsIn([...PAYMENT_CHANNEL_OWNER_TYPES], {
    message: `ownerType must be one of: ${PAYMENT_CHANNEL_OWNER_TYPES.join(', ')}`,
  })
  ownerType!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsIn([...RECEIPT_METHODS], {
    message: `channelType must be one of: ${RECEIPT_METHODS.join(', ')}`,
  })
  channelType!: string;

  /** A human-readable name for the channel, e.g. "Cairo Amman Bank — JOD". */
  @Transform(trimIfString)
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @Transform(trimIfString)
  @MaxLength(120)
  bankName?: string;

  /** The last 2–4 digits of the account — the ONLY bank-account fragment
   * stored (masked form). */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(ACCOUNT_LAST4, {
    message: 'accountLast4 must be 2 to 4 digits',
  })
  accountLast4?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter code, e.g. JOD',
  })
  currency?: string;
}
