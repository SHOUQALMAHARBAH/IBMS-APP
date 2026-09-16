import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PolicyStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /policies` answers three different questions, and which one it is
 * depends on the scope given:
 *
 *   - `opportunityId` — the single policy placed from that opportunity.
 *   - `customerId`    — every policy on that customer.
 *   - neither         — the book-wide list, filtered to what the caller may
 *                       see (`PolicyService.list`).
 *
 * Supplying BOTH is still refused: they are two different questions and
 * answering one silently would be worse than refusing.
 *
 * `status`/`search` apply to the book-wide list. They are shaped exactly like
 * `ListCustomersQueryDto`'s — same `emptyStringToUndefined` transform, same
 * `Length(1, 200)` — so the two list screens behave identically rather than
 * each inventing its own filtering semantics.
 */
export class ListPoliciesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(PolicyStatus))
  status?: PolicyStatus;

  /** `emptyStringToUndefined` matters here: an empty search box must mean
   * "no filter" (show everything), not "search for an empty string". */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;

  /** Applies to the book-wide list only. The two scoped branches are bounded by
   *  construction and return everything they have. 0-based; out-of-range values
   *  are clamped rather than rejected — see `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;
}
