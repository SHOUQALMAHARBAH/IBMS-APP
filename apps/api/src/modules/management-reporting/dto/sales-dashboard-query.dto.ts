import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';

/**
 * `GET /dashboards/sales` (`dashboard.sales.view`). Every filter is
 * optional and independently applicable only where the underlying metric
 * has that dimension — see `sales-dashboard.config.ts`'s header comment.
 * `periodLabel`/`periodStart`/`periodEnd` follow the #60/#61 all-or-none
 * shape: omit all three for the previous UTC calendar month, or supply all
 * three for an explicit window (422 on a partial override).
 */
export class SalesDashboardQueryDto {
  /**
   * THE BRANCH OF WHOEVER **PLACED THE POLICY** — `Policy.placedByUserId`.
   *
   * Owner decision, 2026-11-04: this filter SPLITS, because one control was answering two
   * different questions on one screen. `branchId` keeps the policy meaning (the premium and
   * commission figures), and `leadOwnerBranchId` below carries the other.
   *
   * A manager filtering by one branch was shown premium figures scoped to the officers who PLACED
   * the cover and lead counts scoped to the officers who OWN THE LEAD FILE, under a single label
   * reading "show one branch only" — two different sets of people, with nothing on the screen to
   * tell them apart.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  branchId?: string;

  /**
   * THE BRANCH OF WHOEVER **OWNS THE LEAD FILE** — `Lead.ownerUserId`.
   *
   * Scopes the two lead counts only. Separate from `branchId` because the two resolve against
   * different columns and a reader cannot be expected to know which one a figure used.
   *
   * MEASURED, and it corrected the brief: this meaning was taken to be the CUSTOMER file's owner
   * and it is the LEAD file's. `scripts/measurements/branch-filter-meanings.py` reads the Prisma
   * MODEL at each site rather than the field name, which is what separated them — `ownerUserId`
   * is `Customer`'s on `/dashboards/compliance` and `Lead`'s here, and a field name is not a
   * meaning.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  leadOwnerBranchId?: string;

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
