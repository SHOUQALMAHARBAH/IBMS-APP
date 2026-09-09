import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * `GET /dashboards/executive` (`dashboard.executive.view`). Part E's own
 * cross-cutting rule — "every dashboard filterable by branch / line of
 * business / insurer / time period" — applied to the executive roll-up.
 *
 * Every filter is forwarded to the underlying dashboards that actually have
 * that dimension and silently ignored by the ones that do not (the Compliance
 * dashboard, for instance, takes only `branchId`, because none of its seven
 * registers ties to a `Policy` — see `compliance-dashboard.config.ts`). That
 * is deliberate: an executive filtering by insurer should still see the
 * compliance picture, not an empty section or a 422.
 */
export class ExecutiveDashboardQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  insuranceLine?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  /** The reference date the point-in-time sections are "as of" —
   * `YYYY-MM-DD`, today or earlier. Forwarded to the Claims and Financial
   * dashboards, which are the two `asOf`-shaped ones. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be a calendar date in YYYY-MM-DD form',
  })
  asOf?: string;

  /** All-or-none with `periodStart`/`periodEnd` (the #59/#60/#61 shape the
   * Sales and Policy dashboards already enforce); omit all three for the
   * previous UTC calendar month. */
  @IsOptional()
  @Transform(trimIfString)
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 60)
  periodLabel?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodStart?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  periodEnd?: string;
}
