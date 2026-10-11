import { IsOptional, IsUUID } from 'class-validator';

/**
 * Module 0 item (g) — `POST /employees/:id/cbj-approval/branches` (`employee.update`). Adds one
 * branch to a person's CBJ approval.
 *
 * ## "EXACTLY ONE CATALOGUE" IS CHECKED IN THE SERVICE, NOT HERE
 *
 * The same reasoning as `AddScopeBranchDto` one level up, and it is the reason rather than a
 * convention: `@IsOptional()` installs a condition that skips EVERY validator on its property when
 * the value is absent, so a class-level constraint on either optional field would be skipped in
 * precisely the case it exists for — a caller who sends NEITHER. The check lives in
 * `EmployeeCbjApprovalService`, where it always runs, and both the neither and the both case are
 * proven over real HTTP.
 *
 * The DATABASE is the control either way: `EmployeeCbjApprovalBranch_exactly_one_line` refuses the
 * shape however the row is written.
 *
 * ## No TYPE field, deliberately
 *
 * Every catalogue line carries a `category` of exactly GENERAL or LIFE, so the approved type
 * follows from the branch. Accepting a type would let a caller assert one the catalogue disagrees
 * with — and item (f) counts staff against those types.
 */
export class AddCbjApprovalBranchDto {
  /** A standard catalogue line. Omit when naming an office line. */
  @IsOptional()
  @IsUUID()
  insuranceLineId?: string;

  /** This office's own line. Omit when naming a standard one. */
  @IsOptional()
  @IsUUID()
  officeInsuranceLineId?: string;
}
