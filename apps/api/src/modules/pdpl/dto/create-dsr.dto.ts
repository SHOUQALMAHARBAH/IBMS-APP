import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import {
  DSR_INTAKE_CHANNELS,
  DSR_REQUEST_TEXT_MAX_LENGTH,
  DSR_REQUEST_TEXT_MIN_LENGTH,
  DSR_TYPES,
} from '../dsr.config';

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

  /**
   * What the person actually asked for, as received and in their own words.
   *
   * REQUIRED — and this DTO is the ONLY thing that enforces it, deliberately. The column is
   * nullable because the requests that predate it are not backfilled (inventing what a data
   * subject asked for is the one thing this record must never contain), and a `NOT VALID` CHECK
   * fires on UPDATE, so it would refuse the CLOSURE of those requests. Migration
   * `20261214100000` asserts the absence of both and explains why.
   *
   * The consequence is stated rather than discovered: a future write path that bypasses this
   * class can create a row with neither field. `dsr.e2e-spec.ts` refuses each omission ONE AT A
   * TIME, because a request missing both would pass while only one rule was still enforced.
   */
  // TRIMMED BEFORE THE LENGTH CHECK, and this was a real defect my own e2e caught: without it
  // `@Length(3, …)` counts three SPACES as length 3, so a blank request satisfied the floor and
  // the service's own trim then stored an empty string — `expected 400, got 201`. `trimIfString`
  // exists for exactly this and says so in its own comment: *pair with `@IsString()`/
  // `@MinLength()` so " x " can't slip past a length check.* It is the only trim now; the
  // service does not trim again, because two places that trim are two answers about what was
  // stored.
  @Transform(trimIfString)
  @IsString()
  @Length(DSR_REQUEST_TEXT_MIN_LENGTH, DSR_REQUEST_TEXT_MAX_LENGTH)
  requestText!: string;

  /** How it arrived. REQUIRED for the same reason, and the procedure's own words are why it
   *  exists: a request is logged the same business day *regardless of channel*, which makes the
   *  channel a fact a regulator asks for. */
  @IsIn(DSR_INTAKE_CHANNELS, {
    message: `intakeChannel must be one of: ${DSR_INTAKE_CHANNELS.join(', ')}`,
  })
  intakeChannel!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  dpoHandlerUserId?: string;
}
