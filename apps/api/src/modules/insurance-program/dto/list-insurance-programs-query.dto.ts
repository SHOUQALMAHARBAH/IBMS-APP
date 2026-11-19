import { IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /insurance-programs` answers two questions, and which one depends on the scope given:
 *
 *   - `customerId` — every programme on that customer (unchanged; existing links keep working).
 *   - neither      — the book-wide list, filtered to what the caller may see
 *                    (`InsuranceProgramService.list`).
 *
 * 🔴 OWNER DECISION 150 RULING 1 added the second. Before it, `customerId` was REQUIRED, so the
 * sidebar entry led to a screen with one sentence and nothing on it.
 *
 * Shaped exactly like `ListPoliciesQueryDto`'s filters, so the three list screens behave
 * identically rather than each inventing its own semantics.
 */
export class ListInsuranceProgramsQueryDto {
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
