import { IsOptional, IsUUID } from 'class-validator';

/**
 * Module 0 item (e) — `POST /broker-license/scope` (`license.manage` / Compliance). Adds one
 * licensed branch to the office's CURRENT term.
 *
 * ## "EXACTLY ONE CATALOGUE" IS CHECKED IN THE SERVICE, NOT HERE, AND THAT IS NOT LAZINESS
 *
 * A branch is a row of either `InsuranceLine` (the 32 standard lines) or `OfficeInsuranceLine` (an
 * office's own addition), and exactly one of the two ids must be named.
 *
 * The obvious spelling — a class-level `@Validate` constraint on one of these fields, the shape
 * `CreateAssetDto` uses — CANNOT WORK HERE, and the reason is worth writing down: `@IsOptional()`
 * installs a condition that skips EVERY validator on its property when the value is absent. The
 * sibling that does use that pattern hangs it off a REQUIRED field (`assetType!`), so it always
 * runs. Both fields here are optional by nature, so a constraint on either would be silently
 * skipped in precisely the case it exists to catch — a caller who sends NEITHER.
 *
 * A validator that does not run in the case it was written for is worse than no validator, because
 * it reads as cover. So the check is in `BrokerLicenseScopeService`, where it always executes and
 * is proven over real HTTP for both the neither and the both case.
 *
 * The DATABASE is the actual control either way: `BrokerLicenseScopeLine_exactly_one_line` refuses
 * the shape however the row is written, including from raw SQL or a migration.
 *
 * ## No TYPE field, deliberately
 *
 * Every catalogue line already carries a `category` of exactly GENERAL or LIFE, so the type follows
 * from the branch. Accepting a type would let a caller assert one that disagrees with the catalogue.
 */
export class AddScopeBranchDto {
  /** A standard catalogue line. Omit when naming an office line. */
  @IsOptional()
  @IsUUID()
  insuranceLineId?: string;

  /** This office's own line. Omit when naming a standard one. */
  @IsOptional()
  @IsUUID()
  officeInsuranceLineId?: string;
}
