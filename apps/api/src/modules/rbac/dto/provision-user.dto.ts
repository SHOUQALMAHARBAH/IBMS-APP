import { RoleName } from '@ibms/db';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * Backlog A.2 — provision a user account WITH its initial role grants.
 *
 * Deliberately distinct from `SignupDto`: public signup creates an account
 * with no roles (and therefore no permissions), which is the correct default
 * for a self-service registration but leaves the account unusable. Every real
 * account in this system is provisioned here, by an administrator, with the
 * roles it needs — role assignment is `user.manage`, never self-service.
 */
export class ProvisionUserDto {
  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsEmail()
  email!: string;

  /** Validated against the Part 10.1 policy in `PasswordService`, not here —
   * one source of truth shared with signup and password reset, INCLUDING the
   * 72-byte bcrypt ceiling. The bound here is only a cheap early reject; it is
   * generous in characters because the real limit is in BYTES and a
   * multi-byte Arabic passphrase hits it far sooner. */
  @IsString()
  @Length(12, 200)
  password!: string;

  @IsOptional()
  @IsIn(['AR', 'EN'])
  languagePreference?: 'AR' | 'EN';

  /**
   * Part II §4.2.2 — the employee's functional grouping, REQUIRED and entirely
   * separate from `roles`.
   *
   * The two are a standing source of confusion the spec calls out by name: a
   * Department says where someone sits in the org chart ("Claims"), a Role says
   * what the system will let them do. One department contains several roles —
   * the Claims department holds both claims officers and their manager — so
   * neither implies the other, and the UI must not present them as one field.
   */
  @IsString()
  @Length(1, 100)
  departmentId!: string;

  /**
   * Part II §4.2.2 — the organizational LOCATION, the third of the form's
   * three independent axes: Branch is where the person sits, Department is
   * what they do, Role is what the system lets them do.
   *
   * Required for the same reason `departmentId` is: §4.2.2 lists it among the
   * fields the admin fills, and `User.branchId` had existed for phases with
   * nothing in the application able to set it. Create one first via
   * `POST /admin/branches`.
   */
  @IsString()
  @Length(1, 100)
  branchId!: string;

  /** At least one role — provisioning a zero-role account is exactly the
   * unusable state this endpoint exists to avoid. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(11)
  @IsEnum(RoleName, { each: true })
  roles!: RoleName[];

  /** Part 5.1 — the EXTERNAL_AUDITOR role's time-boxed access window.
   * `AuthService.assertAccessWindowActive` enforces both bounds at login. */
  /**
   * The HR record this account belongs to, when one exists.
   *
   * Optional and LINK-ONLY: an Employee cannot be created here, because
   * creating one requires a national ID — Highly Confidential under Part 10.2
   * — and a user-provisioning form is not where that should first be typed.
   * HR creates the Employee; this names it.
   *
   * Linking is what makes `Employee.fullName` reachable as the display name.
   * Until an account is linked it falls back to the free-text `fullName`
   * above, which is what every account did before this field existed.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  employeeId?: string;

  @IsOptional()
  @IsDateString()
  accessValidFrom?: string;

  @IsOptional()
  @IsDateString()
  accessValidUntil?: string;
}
