import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from './dto.util';
import { PICKER_MIN_CHARS } from './picker-search.config';

/**
 * The query every picker search takes: one mandatory term, with no unfiltered mode.
 *
 * ## Why the floor is a FACTORY and not a field on one class
 *
 * The floor is a judgement about how much of a particular set one keystroke may return — three for a
 * customer book, three for a policy book, two for a staff list, one for a branch list. A single DTO
 * with the loosest floor would silently relax the customer field's own condition; a single DTO with the
 * strictest would make a one-character branch name unfindable. So the number comes from
 * `PICKER_MIN_CHARS` and each route gets a class with its own floor baked in.
 *
 * `@Transform(trimIfString)` runs before validation, so `'   '` becomes `''` and fails the floor with a
 * 400 rather than reaching the repository as a match-everything pattern. That is the trap that turns a
 * search box into a directory listing without anybody changing a line, and it is why the transform is
 * on the DTO rather than in each service.
 */
export function pickerSearchDto(minChars: number, entity: string) {
  class PickerSearchDto {
    @Transform(trimIfString)
    @IsString()
    @MinLength(minChars, {
      message:
        `q must be at least ${minChars} character${minChars === 1 ? '' : 's'} — ` +
        `the ${entity} search has no "list everything" mode, by design`,
    })
    @MaxLength(200)
    q!: string;
  }
  return PickerSearchDto;
}

// The floors come from `PICKER_MIN_CHARS` and are not retyped here. A literal in this file would be a
// second home for a number the web side already has to agree with, and three copies of a floor is three
// places for the field to start sending a request it knows the server will refuse.

/** `GET /insurers/search` */
export class SearchInsurersDto extends pickerSearchDto(
  PICKER_MIN_CHARS.insurer,
  'insurer',
) {}
/** `GET /policies/search` */
export class SearchPoliciesDto extends pickerSearchDto(
  PICKER_MIN_CHARS.policy,
  'policy',
) {}
/** `GET /admin/users/search` */
export class SearchUsersDto extends pickerSearchDto(
  PICKER_MIN_CHARS.user,
  'user',
) {}
/** `GET /admin/branches/search` */
export class SearchBranchesDto extends pickerSearchDto(
  PICKER_MIN_CHARS.branch,
  'branch',
) {}
