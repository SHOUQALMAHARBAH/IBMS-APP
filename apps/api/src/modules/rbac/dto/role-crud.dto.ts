import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Phase 3 — the DTOs for the office's own Role screen.
 *
 * ## Why names are bounded strings and not an enum of anything
 *
 * A role name is free text the office chooses. `@IsEnum(RoleName)` is what the
 * Phase 3 prep step removed from role ASSIGNMENT for exactly this reason, and
 * creating a role is the other end of the same idea. What is validated is the
 * SHAPE — printable, bounded — because these values reach audit rows, log lines
 * and both languages of the UI.
 *
 * The vocabulary check that remains is uniqueness, which only the database can
 * answer: `@@unique([organizationId, name])`. The service turns the resulting
 * constraint violation into a 422 rather than letting a P2002 surface as a 500.
 */
const NO_CONTROL_CHARACTERS = /^[^\p{C}]+$/u;

export class CreateRoleDto {
  /** The machine name, unique within this office. Shown in audit rows and in the
   *  role picker's fallback, so it is bounded and printable but otherwise the
   *  office's choice. */
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'name must not contain control characters',
  })
  name!: string;

  /** Arabic display name. Required, not optional: Arabic is this system's primary
   *  language, and a role that exists only in Latin script shows up untranslated
   *  mid-sentence on an Arabic page — the same reason `Role.nameAr` is NOT NULL. */
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameAr must not contain control characters',
  })
  nameAr!: string;

  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameEn must not contain control characters',
  })
  nameEn!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  /**
   * The permission codes this role grants, as the matrix submits them.
   *
   * An EMPTY array is legitimate and deliberately allowed: an office may create a
   * role and decide its grants afterwards. A role granting nothing is visible on
   * the screen with a count of zero, which is honest — the alternative would be
   * refusing to save work in progress.
   *
   * `ArrayMaxSize` is a sanity bound above the catalogue's current size, not a
   * statement about it.
   */
  @IsArray()
  @ArrayMaxSize(400)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  permissionCodes!: string[];
}

/** Display fields and the machine name. Grants have their own route, and so do
 *  the two security attributes — see `RoleSecurityAttributesDto`. */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'name must not contain control characters',
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameAr must not contain control characters',
  })
  nameAr?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(NO_CONTROL_CHARACTERS, {
    message: 'nameEn must not contain control characters',
  })
  nameEn?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;
}

/** The whole grant set, replacing whatever the role has. See
 *  `RoleRepository.replacePermissions` for why replacement rather than a delta. */
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(400)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  permissionCodes!: string[];
}

/**
 * The two Part II §4.4 / Part 10.1 attributes, on their own route.
 *
 * These are SECURITY CONTROLS, not settings: `requiresMfaAlways` decides whether
 * a trusted device can shorten the second factor, and both default to the strict
 * value so a role nobody classified is strict. Relaxing one is therefore a
 * deliberate act, which is why this route requires a fresh step-up challenge and
 * writes its own audit row naming who relaxed what on which role.
 *
 * Kept off `UpdateRoleDto` on purpose: folding them in would force a
 * re-authentication for renaming a label, and a challenge people learn to click
 * through is not a control.
 */
export class RoleSecurityAttributesDto {
  @IsOptional()
  @IsBoolean()
  requiresMfaAlways?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresHardwareToken?: boolean;
}
