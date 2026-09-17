import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ClaimStatus } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /claims` has three shapes:
 *
 *   - `?policyId=` — every claim on one policy (the claim block on the
 *     opportunity screen).
 *   - `?customerId=` — every claim for one customer.
 *   - NO scope — the claims QUEUE, filtered to what this caller may see.
 *
 * The unscoped branch is new. Before it, supplying neither was a 422, which
 * left a CLAIMS_OFFICER — the role that works this entire book — with no way
 * to list the claims they are responsible for: the only route to a claim was
 * through the Opportunity it hangs off, behind an `opportunity.read` that role
 * does not hold.
 *
 * Supplying BOTH is still refused: they are two different questions, and
 * answering one silently would be worse than refusing.
 *
 * `status`/`search`/`alertOpen`/`page` apply to the queue. They are shaped
 * exactly like `ListPoliciesQueryDto`'s — same `emptyStringToUndefined`
 * transform, same `Length(1, 200)` — so the two list screens behave
 * identically rather than each inventing its own filtering semantics.
 */
export class ListClaimsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(Object.values(ClaimStatus))
  status?: ClaimStatus;

  /** `emptyStringToUndefined` matters here: an empty search box must mean
   * "no filter" (show everything), not "search for an empty string". */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;

  /**
   * Narrow to claims carrying an unresolved insurer follow-up alert.
   *
   * The one "needs attention" signal offered, because it is the only one that
   * is a stored column rather than a value derived when the view is built —
   * see `ListClaimsFilter.alertOpen` for why a derived filter would be unsafe
   * against a bounded page.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsBooleanString()
  alertOpen?: string;

  /** Applies to the queue only. The two scoped branches are bounded by
   *  construction and return everything they have. 0-based. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}
