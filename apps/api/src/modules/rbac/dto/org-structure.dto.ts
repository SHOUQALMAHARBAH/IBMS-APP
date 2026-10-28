import { IsBooleanString, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Part II §4.2.2 — the two org-structure lookups an administrator has to be
 * able to fill before the provisioning form can be completed at all.
 *
 * Both models are bilingual everywhere else in this system (`nameAr` sits
 * beside `name` on `Branch` and `Department` alike), so both are accepted
 * here.
 *
 * `nameAr` IS REQUIRED NOW — owner decision, 2026-10-28. It used to be
 * optional, on the reasoning that "a brand-new office may not have settled its
 * Arabic wording yet", and that is what the paragraph above said until today.
 * The consequence was a unit with no Arabic name on an Arabic-first platform,
 * which renders as the Latin name to a reader who does not read it — and the
 * office that has not settled its wording is exactly the office that will
 * never come back to it.
 *
 * EXISTING ROWS ARE NOT BACKFILLED AND NOT REJECTED ON READ. A default would
 * be a word nobody chose, which is the invented-value class this repository
 * refuses; measured when this shipped, dev held 6 branches and 6 departments
 * with ZERO missing an Arabic name, and db-test held 25 of 47 and 8 of 31
 * missing one, all e2e leftovers. They are fixed by a person who knows the
 * right word, through the rename control — which already accepts `nameAr`
 * alone, deliberately, for this case.
 */
export class CreateOrgUnitDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 100)
  nameAr!: string;
}

/**
 * The administrative reads — `GET /admin/departments` and `GET /admin/branches`.
 *
 * `includeRetired` defaults to LIVE ONLY, so every existing caller is unchanged and no picker or
 * filter can start offering a retired unit for new work. The administration screen passes it,
 * because a retired unit was otherwise invisible on the only screen that could bring it back and
 * `POST /admin/<kind>/:id/reactivate` would have had no reachable caller.
 *
 * A STRING, matching the house convention for a boolean query parameter (`IsBooleanString` plus a
 * `=== 'true'` comparison at the consumer — `list-claims-query.dto.ts#alertOpen` is the precedent).
 * A `@Type(() => Boolean)` coercion would read the string `'false'` as TRUE, which on this
 * parameter means silently showing retired units to every caller that tried to opt out.
 */
export class ListOrgUnitsDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsBooleanString()
  includeRetired?: string;
}

/**
 * Rename an existing department or branch.
 *
 * Both names optional and at least one required: renaming only the Arabic label is a real edit, and
 * a PATCH that demanded both would force a person to retype the half they were not changing.
 */
export class RenameOrgUnitDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  nameAr?: string;
}
