import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { CommunicationDirection } from '@ibms/db';
import { emptyStringToUndefined, queryBoolean } from '../../../common/dto.util';
import { COMMUNICATION_CHANNELS } from '../communication.config';

/** Process 44 — `GET /communications`. All filters optional; with none, the
 * book-wide Process-44 list (`rfqId IS NULL`), capped, newest first. */
export class ListCommunicationsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn([...COMMUNICATION_CHANNELS])
  channel?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  isMarketing?: boolean;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(CommunicationDirection))
  direction?: string;
}
