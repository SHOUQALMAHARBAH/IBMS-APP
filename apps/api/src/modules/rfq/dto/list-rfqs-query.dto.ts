import { IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /rfqs` answers three questions, and which one depends on the scope given:
 *
 *   - `opportunityId` — every request issued off that opportunity.
 *   - `customerId`    — every request on that customer.
 *   - neither         — the book-wide list, filtered to what the caller may see
 *                       (`RfqService.list`).
 *
 * Supplying BOTH is still refused: they are two different questions and answering one silently
 * would be worse than refusing.
 *
 * 🔴 OWNER DECISION 150 RULING 1 added the third. ⚠️ "Neither" used to be a 422, and the reason
 * was real — an unfiltered list handed to a reader admitted by a CUSTOMER-FILE ANCHOR would be
 * the blanket key that design refused. It still is refused, by the ownership filter rather than
 * by a status code; see `RfqService.list`.
 */
export class ListRfqsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  opportunityId?: string;

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

  /** The book-wide list only. The two scoped branches are bounded by construction and return
   *  everything they have. 0-based; out-of-range values are clamped — see `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;
}
