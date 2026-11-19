import { IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /opportunities` answers two questions, and which one depends on the scope given:
 *
 *   - `customerId` — every opportunity on that customer (unchanged; existing links keep working).
 *   - neither      — the book-wide list, filtered to what the caller may see
 *                    (`OpportunityService.list`).
 *
 * 🔴 OWNER DECISION 150 RULING 1 added the second. Before it, `customerId` was REQUIRED, so the
 * sidebar entry led to a screen with one sentence and nothing on it.
 *
 * `search`/`page`/`pageSize` are shaped exactly like `ListPoliciesQueryDto`'s — same
 * `emptyStringToUndefined` transform, same `Length(1, 200)` — so a reader who has learned one
 * list screen here has learned this one.
 */
export class ListOpportunitiesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  /** `emptyStringToUndefined` matters here: an empty search box must mean "no filter", not
   *  "search for an empty string". */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;

  /** The book-wide list only. The customer-scoped branch is bounded by construction and returns
   *  everything it has. 0-based; out-of-range values are clamped — see `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;
}
