import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/dto.util';

/**
 * Insurer management — the DTOs for an office's own insurer records.
 *
 * ## One body, two registration paths
 *
 * `insurerMasterId` links to a company already in the shared catalogue;
 * `legalName` + `legalNameAr` register one that is in no catalogue. Exactly one of
 * those is expected, and the XOR is NOT expressed with `@ValidateIf` — it lives in
 * `resolveIdentityPath()` as a pure function, because the three ways a body can be
 * wrong each need their own sentence and a decorator can only say "invalid".
 *
 * ## What is deliberately absent
 *
 * `organizationId` — the tenant boundary; supplied by `tenantScopeExtension` and
 * never by a caller. `isActive` — deactivation is its own act with its own impact
 * summary, not a field you can flip in passing while editing a phone number.
 * `linesOffered` — what the company offers is the next commit, which is waiting on
 * the insurance-line vocabulary question.
 */
const NO_CONTROL_CHARACTERS = /^[^\p{C}]+$/u;

/** Applied to every free-text field: the shape check the Role DTOs established.
 *  These values reach audit rows, log lines and both languages of the UI. */
function printable(field: string) {
  return { message: `${field} must not contain control characters` };
}

export class RegisterInsurerDto {
  /** The company's row in the shared catalogue. Mutually exclusive with the two
   *  local name fields below. */
  @IsOptional()
  @IsUUID()
  insurerMasterId?: string;

  /** The company's legal name, when this office is registering one the catalogue
   *  does not have. Unique within the office, case-insensitively — see
   *  `Insurer_one_local_name_per_org`. */
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('legalName'))
  legalName?: string;

  /** Required alongside `legalName`, never on its own. Arabic is this system's
   *  primary language and an insurer's name appears on documents a client reads. */
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('legalNameAr'))
  legalNameAr?: string;

  /**
   * COMPANY-level contact details — the four the directory shows, kept apart from
   * the relationship contacts below because that separation IS the boundary.
   *
   * Phone and email are REQUIRED on both registration paths. They are what make a
   * company findable by anyone who has not dealt with it: a brokerage agreement has
   * to be sent somewhere, and a search result nobody can act on is not a lead. The
   * columns are nullable because insurers registered before this existed have
   * neither and there is nothing honest to backfill — so the requirement lives here,
   * where it applies to new registrations only.
   */
  @IsString()
  @Length(3, 40)
  @Matches(NO_CONTROL_CHARACTERS, printable('companyPhone'))
  companyPhone!: string;

  @IsEmail()
  @Length(3, 320)
  companyEmail!: string;

  /** Optional: it lets somebody check what a company offers before making the call,
   *  and demanding it would add friction for no gain. `require_protocol: false`
   *  because "petra.jo" is what a person types — a renderer has to prepend a scheme
   *  rather than emit that as a relative href. */
  @IsOptional()
  @IsUrl({ require_protocol: false })
  @Length(4, 300)
  companyWebsite?: string;

  /** Optional, and specifically where FORMAL PAPERWORK goes. No control-character
   *  guard, unlike every other free-text field here: a postal address is genuinely
   *  multi-line, and `Customer.registeredAddress` sets that precedent. */
  @IsOptional()
  @IsString()
  @Length(2, 300)
  companyCorrespondenceAddress?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('rfqContactName'))
  rfqContactName?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  rfqContactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(3, 40)
  @Matches(NO_CONTROL_CHARACTERS, printable('rfqContactPhone'))
  rfqContactPhone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('claimsContactName'))
  claimsContactName?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  claimsContactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('underwriterContact'))
  underwriterContact?: string;

  /**
   * Days of credit the insurer extends this office. Bounded at two years: the
   * column is a plain Int, and a typo'd 3650 is a commercial term nobody would
   * notice until a reconciliation used it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(730)
  creditTermsDays?: number;

  /** Free text, not an enum: agencies disagree (A-, A3, BBB+) and this office
   *  records whichever rating it was given. */
  @IsOptional()
  @IsString()
  @Length(1, 20)
  @Matches(NO_CONTROL_CHARACTERS, printable('financialStrengthRating'))
  financialStrengthRating?: string;
}

/**
 * Correcting an existing record.
 *
 * Every field is optional and an empty body is accepted as a no-op rather than a
 * 400 — the alternative is a client that has to diff before it can save.
 *
 * `legalName`/`legalNameAr` are accepted here, unlike `insurerMasterId`, and that
 * asymmetry is the point: a company this office registered itself is the office's
 * own record to correct, and without this a typo in an insurer's name would be
 * permanent — there is no delete, and deactivation is not a fix for a typo. The
 * service refuses both fields for a catalogue-linked row, where the name is not
 * ours.
 */
export class UpdateInsurerDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('legalName'))
  legalName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('legalNameAr'))
  legalNameAr?: string;

  /** The four COMPANY-level fields, all optional here. Correcting a switchboard
   *  number is exactly what a PATCH is for, and these belong to the office's own row
   *  even when the NAME comes from the shared catalogue — so unlike `legalName`,
   *  they are editable on a catalogue-linked insurer too. */
  @IsOptional()
  @IsString()
  @Length(3, 40)
  @Matches(NO_CONTROL_CHARACTERS, printable('companyPhone'))
  companyPhone?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  companyEmail?: string;

  @IsOptional()
  @IsUrl({ require_protocol: false })
  @Length(4, 300)
  companyWebsite?: string;

  @IsOptional()
  @IsString()
  @Length(2, 300)
  companyCorrespondenceAddress?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('rfqContactName'))
  rfqContactName?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  rfqContactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(3, 40)
  @Matches(NO_CONTROL_CHARACTERS, printable('rfqContactPhone'))
  rfqContactPhone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('claimsContactName'))
  claimsContactName?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 320)
  claimsContactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(NO_CONTROL_CHARACTERS, printable('underwriterContact'))
  underwriterContact?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(730)
  creditTermsDays?: number;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  @Matches(NO_CONTROL_CHARACTERS, printable('financialStrengthRating'))
  financialStrengthRating?: string;
}

/**
 * The list query.
 *
 * `isActive` is tri-state on purpose: absent means BOTH, which is the default a
 * management list needs — an office that cannot see what it deactivated cannot
 * offer to reactivate it.
 */
export class ListInsurersQueryDto {
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  isActive?: boolean;

  /** Matched against all four name columns — this office's own Latin and Arabic
   *  names and the catalogue's. Plain containment; the fuzzy, transliteration-aware
   *  match belongs with the directory. */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

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
