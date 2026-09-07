import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { InteractionChannel } from '@ibms/db';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/** Process 10 — log one customer interaction (backlog Part C #10).
 *
 * `channel` is the medium / kind (meeting / call / email / WhatsApp / visit
 * / proposal / renewal / claim / complaint / portal / SMS / other — the
 * `InteractionChannel` enum). `summary` is a free-text note. `occurredAt`
 * defaults to `now()` but can be backdated when logging a call or meeting
 * after the fact — a future ("post-dated") instant is rejected by
 * `CrmService`, not here, so the message can explain why. */
export class LogInteractionDto {
  @IsIn(Object.values(InteractionChannel))
  channel!: InteractionChannel;

  @Transform(trimIfString)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  summary!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  occurredAt?: string;
}
