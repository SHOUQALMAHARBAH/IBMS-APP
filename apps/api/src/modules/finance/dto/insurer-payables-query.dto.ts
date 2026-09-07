import { IsOptional, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Process 34 — `GET /insurer-accounting/payables`. Both params optional: with
 * no `insurerId` the report is book-wide (one row per insurer with an
 * outstanding and/or remitted balance); `asOf` is the reference date — a plain
 * `YYYY-MM-DD`, today or earlier (a future `asOf` is meaningless; the service
 * 422s it), default today.
 */
export class InsurerPayablesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  asOf?: string;
}
