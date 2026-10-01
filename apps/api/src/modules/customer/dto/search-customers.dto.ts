import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/**
 * The search behind `GET /customers/search` — the one field that finds a named customer.
 *
 * ## Why this is not `GET /customers?search=`
 *
 * The list route has an unfiltered mode and must keep it: `/customers` is a paged register somebody
 * browses on purpose. The owner's four conditions for a name-completing field are the opposite of that —
 * nothing on an empty query, nothing before three characters, a bounded result set, every search
 * recorded — and applying them to the list route would break the register screen.
 *
 * So this is a SECOND route, exactly as `GET /employees/search` stands beside `GET /employees`, and for
 * the same stated reason: a field that completes names is closer to a directory by nature, and the
 * conditions are what stop it becoming one. One route per intent, each enforcing its own.
 *
 * ## Three characters, not two
 *
 * The employee search floors at two. The owner set three here, and the difference is not an
 * inconsistency to tidy: an office's staff list is tens of people, where two characters is already
 * narrow, while its customer book is the whole of its business. Both numbers are a decision about how
 * much of the set one keystroke may return, taken per entity.
 *
 * `@Transform` runs before validation, so `'   '` becomes `''` and fails the floor with a 400 rather
 * than reaching the repository as a match-everything pattern — the trap the employee DTO names, and the
 * one that turns a search box into a directory listing without anybody changing a line.
 */
export class SearchCustomersDto {
  @Transform(trimIfString)
  @IsString()
  @MinLength(3, {
    message:
      'q must be at least 3 characters — a customer search has no "list everyone" mode, by design',
  })
  @MaxLength(200)
  q!: string;
}
