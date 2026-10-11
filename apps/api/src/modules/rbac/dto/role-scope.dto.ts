import {
  IsArray,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { InsuranceLineCategory } from '@ibms/db';

/**
 * MODULE 0 ITEM (h) — `PATCH /rbac/roles/:id/scope` (`role.update`).
 *
 * ## `null` and ABSENT mean different things, and both are needed
 *
 * `insuranceLineCategory: null` makes the role UNRESTRICTED again; omitting it leaves the current
 * scope alone. Collapsing them would mean a request that only meant to change the branch list
 * silently widened the role to every insurance type — the same trap the CBJ approval's status has,
 * and the same resolution.
 *
 * ## The branches are a SET, replaced wholesale
 *
 * Not add/remove routes, unlike the licence scope and the CBJ approval, and the reason is the
 * difference between a register and a configuration: those two RECORD what a regulator granted, one
 * branch at a time, each with its own audit row. A role's scope is a setting an administrator tunes
 * on a matrix screen, and a wholesale replace is what makes "these four, not those two" one act
 * with one audit row instead of six.
 *
 * ## No TYPE on the branches
 *
 * A branch is a catalogue row and its category is the catalogue's. The SERVICE refuses a branch
 * whose category disagrees with `insuranceLineCategory`, because deciding that compares two tables
 * and a Postgres CHECK compares columns of one row of one.
 */
export class SetRoleScopeDto {
  /** The insurance type, or null for every type. Absent leaves the current value. */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsEnum(InsuranceLineCategory)
  insuranceLineCategory?: InsuranceLineCategory | null;

  /** Standard catalogue line ids. Empty (with `officeInsuranceLineIds`) = every branch in the type. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  insuranceLineIds?: string[];

  /** This office's own line ids. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  officeInsuranceLineIds?: string[];
}
