import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 66 — `POST /employees` (`employee.manage`). `hireDate` and the
 * two Part 8.2 dates are parsed via `parseHistoricalInstant` in the service
 * (always in the past, like every other backdatable-instant field in this
 * codebase) — validated here only as non-empty strings. `userId` is an
 * OPTIONAL link to an existing login account, finally giving #61 (Employee
 * Performance)'s dormant `User.employeeId` FK a real writer. */
export class CreateEmployeeDto {
  @IsString()
  @Length(1, 200)
  fullName!: string;

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
