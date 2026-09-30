import { IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from './dto.util';

/**
 * A PERSON, as this system records one — shared by the two routes that can create an Employee.
 *
 * ## Why it is here and not in the employee module
 *
 * An office registers a person and, in the same act, may give that person a login. Both halves are
 * written by `POST /admin/users`, because that is where the account rules already live (password
 * policy, role resolution, the segregation signal); the person-only half stays on `POST /employees`.
 * Two routes accepting the SAME person means one definition of what a person is, or the two drift —
 * and a `@Length` that moves in one DTO and not the other is a difference nobody sees until a name
 * that saved on one screen is refused on the other.
 *
 * `src/common/` is where this codebase already keeps things two modules share (`dto.util.ts`,
 * `person-name.util.ts`). There are no cross-module DTO imports anywhere in this repo and this does
 * not add the first.
 *
 * ## The two name sets
 *
 * Four Arabic parts, following the Jordanian national-ID convention, and four English ones. The flat
 * `fullName` / `fullNameEn` are composed server-side by `composeFullName()` and are never accepted
 * from a caller — a name typed twice is a name that disagrees with itself.
 *
 * The English set is entirely OPTIONAL, including for a person whose Arabic name is complete. This is
 * deliberate and it is the owner's decision: transliterating an Arabic name is a judgement about a
 * real person's identity, and the system must not guess one. An employee with no English name has
 * NULLs there, and the screens fall back to the Arabic — a missing English name is visibly missing.
 */
export class PersonRecordDto {
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

  /** Optional as a SET: none, some or all. `fullNameEn` is composed from whatever is given. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  givenNameEn?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  fatherNameEn?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  grandfatherNameEn?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  familyNameEn?: string;

  /** Highly Confidential (Part 10.2) — encrypted at rest, masked on read, revealed only behind
   *  `employee.national-id.reveal` with a reason. Never logged, never audited as a value. */
  @IsString()
  @Length(1, 100)
  nationalId!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  position?: string;

  /** Parsed by `parseHistoricalInstant` in the service, like every backdatable instant here. */
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
}
