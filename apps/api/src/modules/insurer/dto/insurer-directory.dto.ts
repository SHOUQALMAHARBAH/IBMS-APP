import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Searching the cross-office directory.
 *
 * Plain containment on the company name in either script. The fuzzy,
 * transliteration-aware match belongs with the registration matcher, which has to answer
 * a harder question ("is this the same company as one of these?") than a person typing a
 * few letters into a search box.
 *
 * ## `lineCode` — the filter this shipped WITHOUT, and the objection that kept it out
 *
 * This comment used to read: "No filter by line, by structure, or by anything else yet:
 * the directory is a lead list an office scans, and every additional filter is a place
 * where a wrong default could hide a company that does write the cover somebody needs."
 *
 * Kept verbatim rather than deleted, because the risk it names is real and the filter had
 * to answer it. What the objection missed is that the feature exists so an office does not
 * have to discover who writes a line by asking around — and a directory searchable only
 * by company name cannot answer that question at all. The absent filter was not a neutral
 * omission; it was the use case missing.
 *
 * So: one axis, the PLATFORM line code, and `InsurerDirectoryService.resolveLine` refuses
 * a code the catalogue does not have rather than returning an empty page. There is still
 * no filter by structure, by country, or by anything else, and that part of the objection
 * stands — a `structure` filter defaulting to CONVENTIONAL would hide every takaful
 * company from an office that never touched the control.
 *
 * Not accepted here, deliberately: a free-text line NAME, and a list of codes. A name
 * would put string matching back on a path this branch spent weeks taking it off. A list
 * needs an ANY-versus-ALL decision — "writes motor OR medical" and "writes both" are
 * different questions — and guessing which one a caller meant is precisely the wrong
 * default the objection warns about.
 */
export class ListInsurerDirectoryQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  /**
   * A platform line code, e.g. `MOTOR_COMPREHENSIVE`.
   *
   * Shape-validated here and EXISTENCE-validated in the service, which are different jobs:
   * this rejects a caller sending a name or a uuid where a code belongs, and the service
   * rejects a well-shaped code no line answers to. Neither can be dropped in favour of the
   * other — without the shape rule a 200-character search phrase reaches a database
   * lookup, and without the existence check a plausible-looking typo returns an empty page
   * that reads as an answer.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,63}$/, {
    message:
      'lineCode must be a platform insurance line code in SCREAMING_SNAKE_CASE, e.g. MOTOR_COMPREHENSIVE. Line NAMES and office-added lines are not filter axes; GET /insurance-lines lists the codes.',
  })
  lineCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
