import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CommunicationDirection, InteractionChannel } from '@ibms/db';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/** Process 12 — Market Placement (backlog Part C #12, Domain B). Log one
 * broker<->insurer exchange on an RFQ: an insurer's query (`INBOUND`) or the
 * broker's answer / additional-information note (`OUTBOUND`).
 *
 * `channel` is the medium (email / call / portal / ... — the
 * `InteractionChannel` enum, shared with CRM). `body` is the free text of
 * the query / answer. `rfqInsurerId` pins the row to one shortlisted
 * insurer; omit it for something addressed to / from the whole panel.
 * `occurredAt` defaults to now() but can be backdated — an offset-less
 * datetime or a future instant is rejected by `RfqService`, not here, so the
 * message can explain why. */
export class LogRfqCommunicationDto {
  @IsIn(Object.values(CommunicationDirection))
  direction!: CommunicationDirection;

  @IsIn(Object.values(InteractionChannel))
  channel!: InteractionChannel;

  @Transform(trimIfString)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  rfqInsurerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  occurredAt?: string;
}
