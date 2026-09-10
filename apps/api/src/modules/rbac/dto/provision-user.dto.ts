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

  /** At least one role — provisioning a zero-role account is exactly the
   * unusable state this endpoint exists to avoid. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(11)
  @IsEnum(RoleName, { each: true })
  roles!: RoleName[];

  /** Part 5.1 — the EXTERNAL_AUDITOR role's time-boxed access window.
   * `AuthService.assertAccessWindowActive` enforces both bounds at login. */
  @IsOptional()
  @IsDateString()
  accessValidFrom?: string;

  @IsOptional()
  @IsDateString()
  accessValidUntil?: string;
}
