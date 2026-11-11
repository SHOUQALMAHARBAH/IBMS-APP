import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * AN OFFICE DECLARING A LEGAL VALUE — OWNER DECISION 123's three conditions, two of them here.
 *
 * The third (its own permission) is `legal-value.declare` on the route. All three fall on the
 * manager ONCE and never on the employee, which is the whole point of a standing declaration: the
 * compliance feature must not cost more clicks than paper.
 *
 * ## WHAT IS NOT ON THIS DTO, AND WHY
 *
 * `sourceType`. An office row is always `OFFICE_DECLARATION` — a CHECK constraint ties the source
 * type to the ownership in both directions, so a field here would be a value the caller could set
 * and the database would then refuse. Criterion 7 is enforced by the CHECK and the RLS policy, not
 * by a DTO, so there is nothing for the caller to say.
 *
 * `organizationId`. Stamped by `tenantScopeExtension`; a field would be a way to name another
 * office's row, which RLS refuses anyway.
 */
export class DeclareLegalValueDto {
  /** The code this value is for. Must be one the instrument DEFERS; a code it states belongs to
   *  the provider and the read refuses a row that competes with one. */
  @IsString()
  @Length(3, 100)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message:
      'code must be an upper-case identifier, e.g. COMMISSION_BASIS_AND_CEILING — it is quoted in ' +
      'governance documents and must not change when the value does',
  })
  code!: string;

  /** What this value is, in the office's own words. English only in this batch: no screen ships
   *  and no Arabic is invented — every string a person will read goes to the owner first. */
  @IsString()
  @Length(3, 200)
  name!: string;

  @IsIn([
    'MONEY_JOD',
    'COUNT',
    'CALENDAR_DAYS',
    'YEARS',
    'PERCENT',
    'DATE',
    'TEXT_LIST',
  ])
  kind!:
    | 'MONEY_JOD'
    | 'COUNT'
    | 'CALENDAR_DAYS'
    | 'YEARS'
    | 'PERCENT'
    | 'DATE'
    | 'TEXT_LIST';

  /**
   * The figure, as a STRING.
   *
   * A string and not a number because a JOD amount may never exist as a JS number in this
   * codebase (`money-decimal-jod.md`) — and because the same column holds counts and spans, so one
   * type for all of them beats a union nobody can validate.
   *
   * OPTIONAL, and the absence is a real state: a declared code with no figure is DORMANT
   * (criterion 6). Nothing may rest on it — no exemption, no automatic refusal, no alert — and
   * that is different from a zero, which would be a figure.
   */
  @IsOptional()
  @IsString()
  @Matches(/^-?\d{1,15}(\.\d{1,3})?$/, {
    message:
      'value must be a plain decimal with at most three places, e.g. "2000" or "2000.500" — the ' +
      'column is Decimal(18,3) and a JOD figure may never be a JS number',
  })
  numericValue?: string;

  /** For `kind: 'DATE'` only. A CHECK refuses a figure in the wrong column. */
  @IsOptional()
  @IsISO8601()
  dateValue?: string;

  /**
   * DECISION 123's SECOND CONDITION — mandatory, and a CHECK enforces it at the database too.
   *
   * The office's own reference for what it declared: a Central Bank decision number, a letter, a
   * board minute. Without it the row asserts a legal value on nobody's authority, which is what
   * OWNER DECISION 123 forbids and what this table exists to make impossible — that decision's
   * own file records the lineage of the rule, which is its one home.
   */
  @IsString()
  @Length(3, 300)
  sourceReference!: string;

  /** DECISION 123's THIRD CONDITION — mandatory. The day the value starts applying, which is what
   *  makes criterion 3 work: an old transaction computes at the row in force on ITS day. */
  @IsISO8601()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
