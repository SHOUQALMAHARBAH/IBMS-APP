import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 66 — `POST /employees` (`employee.create`). `hireDate` and the
 * two Part 8.2 dates are parsed via `parseHistoricalInstant` in the service
 * (always in the past, like every other backdatable-instant field in this
 * codebase) — validated here only as non-empty strings. `userId` is an
 * OPTIONAL link to an existing login account, finally giving #61 (Employee
 * Performance)'s dormant `User.employeeId` FK a real writer.
 *
 * Part F item #4 — the Jordanian national-ID-convention name parts
 * (given/father's/grandfather's/family name) always apply here (an Employee
 * is always a real individual); the flat `fullName` is computed
 * server-side from them (see `composeFullName()`), not accepted directly. */
export class CreateEmployeeDto {
  @IsString()
  @Length(1, 150)
  givenName!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  fatherName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  grandfatherName?: string;

  @IsString()
  @Length(1, 150)
  familyName!: string;

  @IsString()
  @Length(1, 100)
  nationalId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  position?: string;

  @IsString()
  hireDate!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  licensedRole?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  confidentialityAgreementSignedAt?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  backgroundCheckCompletedAt?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  userId?: string;

  /**
   * Spec §4.1.2 — the employee's functional grouping on the org chart.
   *
   * Optional, and distinct from the `departmentId` an admin sets on the
   * ACCOUNT at provisioning (§4.2.2): this is the HR record of a person, that
   * is a field on a login. When this is left unset and `userId` names an
   * account that has one, the employee adopts the account's — see
   * `EmployeeRepository.linkUser`. When both are set and they disagree, the
   * request is refused rather than silently resolved.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  departmentId?: string;
}

/**
 * Phase 3 — `PATCH /employees/:id` (`employee.update`).
 *
 * There was no way to correct an employee record at all: the module shipped with
 * create, list, get and reveal, and nothing else. The unified User/Employee screen
 * needs somewhere to submit a correction, so this DTO and its route arrive
 * together with the permission that gates them.
 *
 * Deliberately NARROWER than `CreateEmployeeDto`. Three things it does not accept:
 *
 *  - `nationalId`. Changing the identity a record is built on is not a
 *    correction; it is a different person. Part 10.2 treats that field as Highly
 *    Confidential and it is write-once here — an actual data-entry error in it
 *    needs a decision about the old record, not a silent overwrite.
 *  - `userId`. Linking an account to an HR record is its own operation with its
 *    own rules (`EmployeeRepository.linkUser` refuses a link that disagrees with
 *    the account's department), and folding it into a general edit would let a
 *    relink happen as a side effect of fixing a job title.
 *  - The name parts. `fullName` is composed server-side from them, and a rename
 *    of a real person is a heavier act than this route is for.
 */
export class UpdateEmployeeDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  position?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  licensedRole?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  confidentialityAgreementSignedAt?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  backgroundCheckCompletedAt?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  departmentId?: string;
}

/** `field` is fixed to `'nationalId'` — Employee has exactly one
 * `-- ENCRYPT` field, unlike Customer's three — but kept as an explicit
 * enum (not hardcoded server-side) for the same reason `RevealFieldDto`
 * (customer) is: a self-documenting request body. */
export class RevealEmployeeFieldDto {
  @IsIn(['nationalId'] as const)
  field!: 'nationalId';

  @IsString()
  @Length(10, 1000)
  reason!: string;
}
