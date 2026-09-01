import { IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 18 — create a `Policy` from an accepted Opportunity and set the
 * inception date. The Opportunity must carry a `ClientDecision` of `ACCEPT`
 * and must not already have a `Policy` (409). Insurer / insurance line /
 * requested premium / currency are taken from the accepted recommendation's
 * quotation, not the request body. */
export class PlacePolicyDto {
  @IsUUID()
  opportunityId!: string;

  /** When cover incepts. A plain date (`2026-10-01`) is the expected form;
   * a datetime must carry an explicit offset (see `parseCalendarDate`). May
   * be in the future. */
  @IsISO8601()
  inceptionDate!: string;

  /** Optional at placement — the insurer confirms the exact period at
   * issuance. When given it must be after `inceptionDate`. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsISO8601()
  expiryDate?: string;
}
