import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { LanguagePreference } from '@ibms/db';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import {
  COMMUNICATION_CHANNELS,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
} from '../communication.config';

/**
 * Process 44 — `POST /communications` (`communication.send`). Logs one
 * outbound customer communication.
 *
 * `channel` / `languageUsed` are OPTIONAL: omitted, they are taken from the
 * customer's record (`preferredContactChannel` / `languagePreference`); an
 * explicit value that disagrees is a 422 ("respect the customer's recorded
 * channel and language"). `isMarketing` gates the send on the customer's
 * MARKETING `ConsentRecord`. `sentAt` defaults to now() but may be backdated
 * (validated in the service — an offset-less / future instant is rejected
 * there so the message can explain why).
 */
export class CreateCommunicationDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...COMMUNICATION_CHANNELS], {
    message: `channel must be one of: ${COMMUNICATION_CHANNELS.join(', ')}`,
  })
  channel?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(LanguagePreference))
  languageUsed?: string;

  /** A marketing communication — the `ConsentRecord` gate applies. Omit /
   * false for a service or transactional message. */
  @IsOptional()
  @IsBoolean()
  isMarketing?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  templateId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `subject ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  subject?: string;

  /** The message content. A Confidential-tier business note — returned
   * unmasked but kept out of the audit row; a full bank / card number belongs
   * on an approved `PaymentChannel` (Process 38), not here. */
  @Transform(trimIfString)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `body ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  body!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  sentAt?: string;
}
