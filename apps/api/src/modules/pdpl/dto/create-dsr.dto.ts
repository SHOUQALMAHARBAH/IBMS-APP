import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { DSR_TYPES } from '../dsr.config';

/**
 * M04 — `POST /dsr` (`dsr.log`). Logs a request the moment it is received,
 * regardless of channel — `receivedAt` is always `new Date()` (see
 * `dsr.config.ts`'s `DSR_RECEIVED_AT_IS_ALWAYS_NOW`), never caller-supplied.
 * Exactly one of `customerId` / `insuredPersonId` identifies the data
 * subject (validated in the service — `hasExactlyOneOwner`).
 * `dpoHandlerUserId` may be assigned at intake, or later via
 * `POST /dsr/:id/assign`.
 */
export class CreateDsrDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insuredPersonId?: string;

  @IsIn(DSR_TYPES, {
    message: `type must be one of: ${DSR_TYPES.join(', ')}`,
  })
  type!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  dpoHandlerUserId?: string;
}
