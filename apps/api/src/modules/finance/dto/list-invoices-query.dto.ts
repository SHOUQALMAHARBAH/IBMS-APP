import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * `GET /invoices` answers three different questions, and which one it is depends on the scope
 * given:
 *
 *   - `policyId`   — every invoice on that policy.
 *   - `customerId` — every invoice on that customer.
 *   - neither      — the office's invoice list, filtered and paginated.
 *
 * 🔴 THE THIRD BRANCH IS NEW — DECISION 167/13, AND THE REASON THE OLD REFUSAL GAVE WAS NOT A
 * REASON FOR THIS NEED.
 *
 * This DTO used to carry the two scopes alone, and the service 400'd on neither with the sentence
 * «a book-wide invoice list is the Process 33 ageing report». Measured 2026-11-28: it is not.
 * `GET /client-accounting/ageing` returns **one row per CUSTOMER** with an outstanding balance — an
 * invoice COUNT, an oldest due date and buckets — and `GET /insurer-accounting/payables` returns
 * one row per INSURER. Neither is a list of invoices, and neither carries an invoice id, so
 * neither can be the surface a finance officer uses to find the invoice they are recording a
 * receipt against.
 *
 * ⟶ So the refusal was answering a REPORTING question («give me the book as a dump») with a
 *   reporting answer, and the question decision 167/13 asks is an OPERATIONAL one: *which invoice
 *   am I collecting on.* The old sentence is kept in the service's own comment as the history of
 *   what it used to refuse.
 *
 * ## ⛔ Supplying both scopes is still refused
 *
 * `policyId` and `customerId` are two different questions and answering one silently would be
 * worse than refusing — `ListPoliciesQueryDto`'s own rule, which this file now mirrors field for
 * field so the two list screens cannot behave differently.
 *
 * ## The filters apply to the book-wide branch only
 *
 * The two scoped branches are bounded by construction (one policy, one customer) and return
 * everything they have, which is what `FinanceSection` already depends on.
 */
export class ListInvoicesQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  policyId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  /**
   * THE INSURER — decision 167/13's reconciliation table picks one and lists its open invoices.
   *
   * ⚠️ `Invoice` CARRIES NO INSURER COLUMN. The insurer is reached through
   * `Invoice.policyId → Policy.insurerId`, so this filter is a nested `where` on the policy
   * relation and an invoice with no policy (`policyId: null` is permitted by the schema) can never
   * match it. That is correct rather than a limitation: an invoice with no policy has no insurer to
   * remit to, which is the same thing `CollectionService.recordRemittance` 422s on by name.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insurerId?: string;

  /**
   * «OPEN» — anything not yet remitted, which is the set a finance officer still has work on.
   *
   * ⛔ NOT a free `status` filter, and that is deliberate. `InvoiceStatus` has six values and two
   * of them (`EXCEPTION_RAISED`, `EXCEPTION_RESOLVED`) are reconciliation states rather than
   * positions in the collection cycle, so a reader filtering «open» by picking statuses would have
   * to know which four to pick. One flag with one meaning, and the service owns which statuses it
   * covers.
   *
   * A string rather than a boolean because it arrives in a query string, where `?open=false` would
   * otherwise be the truthy string `'false'` — the shape `ListPoliciesQueryDto`'s own booleans
   * avoid by not having any.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(['true', 'false'])
  open?: string;

  /** `emptyStringToUndefined` matters here: an empty search box must mean "no filter" (show
   *  everything), not "search for an empty string". Shaped exactly like
   *  `ListPoliciesQueryDto.search`. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  search?: string;

  /** Applies to the book-wide list only. The two scoped branches are bounded by construction and
   *  return everything they have. 0-based; out-of-range values are clamped rather than rejected —
   *  see `common/pagination.ts`. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  pageSize?: number;
}
