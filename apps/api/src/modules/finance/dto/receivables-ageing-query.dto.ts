import { IsOptional, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 33 — `GET /client-accounting/ageing`. Both params optional: with no
 * `customerId` the report is book-wide (one row per customer with an
 * outstanding balance); `asOf` is the ageing reference date — a plain
 * `YYYY-MM-DD`, today or earlier (an ageing report of the future is
 * meaningless; the service 422s a future date), default today.
 */
export class ReceivablesAgeingQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  asOf?: string;
}
