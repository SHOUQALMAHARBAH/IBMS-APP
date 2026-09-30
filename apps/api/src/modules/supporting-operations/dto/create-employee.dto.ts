import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { PersonRecordDto } from '../../../common/person-record.dto';

/** Process 66 — `POST /employees` (`employee.create`). `hireDate` and the
 * two Part 8.2 dates are parsed via `parseHistoricalInstant` in the service
 * (always in the past, like every other backdatable-instant field in this
 * codebase) — validated here only as non-empty strings. `userId` is an
 * OPTIONAL link to an existing login account, finally giving #61 (Employee
 * Performance)'s dormant `User.employeeId` FK a real writer.
 *
 * The person's own fields — both name sets, national ID, position, hire date — live on
 * `PersonRecordDto` in `src/common/`, shared with the `employee` block of `ProvisionUserDto` so
 * that one route cannot accept a person the other refuses. What remains here is what only the
 * person-ONLY route has: the link to an existing account, and the two org-unit ids. */
export class CreateEmployeeDto extends PersonRecordDto {
  /**
   * An OPTIONAL link to an existing login account, for the case the unified form does not cover:
   * an account that already exists (provisioned before its HR record, or an auditor who later
   * became staff). Creating the pair in one act goes through `POST /admin/users`, which owns the
   * account rules — see `PersonRecordDto`.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  userId?: string;

  /**
   * Spec §4.1.2 — the employee's functional grouping on the org chart.
   *
   * Optional, and distinct from the `departmentId` an admin sets on the ACCOUNT at provisioning
   * (§4.2.2): this is the HR record of a person, that is a field on a login. When this is left unset
   * and `userId` names an account that has one, the employee adopts the account's — see
   * `EmployeeRepository.linkUser`. When both are set and they disagree, the request is refused
   * rather than silently resolved.
   *
   * The unified form makes that disagreement UNREACHABLE for a person and account created together:
   * there is one department field on the screen and it feeds both rows.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  departmentId?: string;

  /**
   * §4.2.2's third axis — the organizational LOCATION.
   *
   * `Employee.branchId` arrived with nothing writing it (migration 20261024100000). This is its
   * first writer, and its absence was part of why a person and an account could not be registered in
   * one act: `ProvisionUserDto` REQUIRES a branch and the HR record had nowhere to keep one, so the
   * two halves of one person could never carry the same facts.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  branchId?: string;
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
