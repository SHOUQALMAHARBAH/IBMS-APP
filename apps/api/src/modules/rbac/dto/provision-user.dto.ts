import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PersonRecordDto } from '../../../common/person-record.dto';

/**
 * The person half of "register someone and give them a login", as ONE act.
 *
 * Nothing but the shared person definition. Department and branch are deliberately NOT here: they are
 * already on the account, one field each, and one field cannot disagree with itself. The old failure
 * mode — an HR record and an account naming different departments, refused by a ConflictException on
 * both link paths — becomes unreachable rather than caught.
 */
export class ProvisionEmployeeDto extends PersonRecordDto {}

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
  /**
   * The display name — REQUIRED for an account with no person record, and REFUSED when `employee`
   * is present.
   *
   * `User.fullName` stays a stored, NOT NULL column: an audit row holds a `userId` and nothing
   * else, so the name has to be readable from the account itself years later, and an account need not
   * have an employee at all (the external auditor). Stored does not mean typed twice — when a person
   * record is being created here the name is COMPOSED from its four parts, and sending both would be
   * two spellings of one person with nothing to say which is right.
   */
  @ValidateIf((o: ProvisionUserDto) => o.employee === undefined)
  @IsString()
  @Length(1, 200)
  fullName?: string;

  /**
   * Create the person and the account in ONE request, in one transaction.
   *
   * Two calls from a browser was the shape this replaces: the second can fail, and then a person
   * half-exists with no way for whoever pressed Save to tell which half. It also required the HR
   * record to be created FIRST and named here by id, so the screen had a picker listing every
   * employee — and the person being registered was, by definition, never in it.
   *
   * Requires `employee.create` IN ADDITION to the `user.manage` that gates this route. A Manager
   * holds the first and not the second, which is a real state: a Manager registers people and cannot
   * hand out logins.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProvisionEmployeeDto)
  employee?: ProvisionEmployeeDto;

  /**
   * How this account authenticates — recorded, and only recorded.
   *
   * `DEFAULT` is a password held here. `WINDOWS` states that the office intends this account to be
   * a domain login; nothing in the product reads it yet and a `WINDOWS` account still gets a
   * password, because refusing one would lock the account out of a system with no directory
   * integration. It is a column so that integration is a provider config hanging off an existing
   * fact, rather than a migration of every account on the day it arrives.
   */
  @IsOptional()
  @IsIn(['DEFAULT', 'WINDOWS'])
  registrationType?: 'DEFAULT' | 'WINDOWS';

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

  /**
   * At least one role — provisioning a zero-role account is exactly the
   * unusable state this endpoint exists to avoid.
   *
   * Role IDS, not names. A name is unique only within an office and an office
   * can edit it, so it is not an identity; see `RoleAssignmentDto` for the
   * rename-mid-request race that removes. The service resolves every id on the
   * tenant-scoped client and answers 422 if any is unknown, which is both the
   * real check and what keeps one office from probing another's roles.
   *
   * `ArrayMaxSize` is a sanity bound on one request, not "the size of the
   * catalogue" — an office may define more than eleven roles.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  roleIds!: string[];

  /** Part 5.1 — the EXTERNAL_AUDITOR role's time-boxed access window.
   * `AuthService.assertAccessWindowActive` enforces both bounds at login. */
  /**
   * The HR record this account belongs to, when one exists.
   *
   * Optional and LINK-ONLY: it names an HR record that ALREADY EXISTS.
   *
   * To create the person here instead, send `employee` — the two are mutually exclusive and sending
   * both is a 422. This comment used to argue that an Employee must never be created on this route,
   * because a national ID is Highly Confidential under Part 10.2 and "a user-provisioning form is not
   * where that should first be typed". The classification is unchanged and the field is still
   * encrypted, masked and reveal-gated. What changed is the premise: the owner's form is no longer a
   * user-provisioning form, it is a PERSON form that can also issue a login, so the national ID is
   * typed exactly where it belongs — on the HR record — and this route is what writes both rows
   * atomically.
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
