import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * The search behind `GET /employees/search` — the ONLY way a Compliance Officer can find the person whose
 * national ID they are about to reveal.
 *
 * ## The term is MANDATORY, and that is the whole design
 *
 * `employee.national-id.reveal` is held by COMPLIANCE_OFFICER alone, and that role holds NO `employee.read`
 * — deliberately, since RBAC Phase 3 split the reveal out of `employee.manage` precisely so the people who
 * administer staff records are not the people who can decrypt a national ID. The consequence, measured as
 * IMPROVEMENTS § 1.83, was that the reveal was unusable by its only holder: the route accepted the call and
 * the employee's id was undiscoverable, because both employee reads require `employee.read`.
 *
 * The owner refused the wide fix (grant Compliance `employee.read`) and refused leaving it unusable. This
 * is the narrow one: **find a named person, reveal, nothing more.**
 *
 * So `q` is REQUIRED with a floor, and it is TRIMMED FIRST. A whitespace-only term is the trap — it
 * satisfies a bare `@IsString()` and then matches everything, which is the "empty search returns everyone"
 * case the owner named as the way this decays into a staff directory by another name. Trimming before the
 * length check is what makes that unrepresentable rather than merely discouraged.
 *
 * There is deliberately no `page`, no `take` and no "list all" mode. A parameter that can widen the result
 * set is the next step toward the thing this replaces.
 */
export class SearchEmployeesDto {
  /**
   * A name fragment. Two characters is the floor: one character matches a large fraction of any staff list
   * and is browsing with extra steps, which is condition 1 of the owner's four.
   *
   * `@Transform` runs before validation, so `'   '` becomes `''` and fails `@MinLength(2)` with a 400
   * rather than reaching the repository as a match-everything pattern.
   */
  @Transform(trimIfString)
  @IsString()
  @MinLength(2, {
    message:
      'q must be at least 2 characters — an employee search has no "list everyone" mode, by design',
  })
  @MaxLength(100)
  q!: string;
}
