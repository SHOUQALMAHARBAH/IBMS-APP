import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * MODULE 0-ب ITEM (e) — REGISTERING AN INSURANCE COMPANY. The corrected field dictionary's insurer
 * sheet («شركة التأمين»), 38 fields, in its own groups and its own order.
 *
 * ## THE SHEET IS 38 AND THIS FORM TYPES 25, WHICH IS THE WHOLE OF DECISION 63 MADE VISIBLE
 *
 * Thirteen of the 38 are not typed here, and each is absent for a stated reason rather than an
 * oversight:
 *
 *   * **#1, #32-#36** — the id, the record status and created/updated at/by. Written by the server. A
 *     caller who could set `created_by` could attribute the registration of a tenant to somebody else.
 *   * **#12 `license_status_id`** — DERIVED. Decision 71 and the dictionary's correction 3: «حالة
 *     الترخيص لا تُخزَّن». There is no column and there must not be one.
 *   * **#15, #16, #37 — the financial strength rating, its agency and its as-of date.** These are
 *     NOT company facts. Decision 64: the rating is what an OFFICE recorded in performing its duty of
 *     care when choosing an insurer, so it lives on that office's own `Insurer` row and a company
 *     cannot publish one about itself.
 *   * **#25-#27 — the broker-relations contact.** Same reason, one step sharper: each brokerage office
 *     deals with a DIFFERENT named person inside the same company, so a single value on the company
 *     would hold one office's contact and show it to every other.
 *
 * The published channels — #23 `quotation_email` and #24 `claims_email` — ARE company facts and are
 * typed here. The line between them and the named human is the line `Insurer` already drew between
 * `companyEmail` and `claimsContactName`.
 *
 * ## WHAT THE SHEET DOES NOT ASK FOR AND THIS FORM NEEDS
 *
 * `subdomain`, for the same reason the brokerage form needs it: it is how this platform addresses a
 * tenant, it is `NOT NULL UNIQUE`, and no registration can omit it. One sentence, which is the test
 * every field on this screen has to pass.
 */
export class RegisterInsuranceCompanyDto {
  // ------------------------------------------------------------------ identity (#2-#9)

  /** #2 `insurer_code` — ONE namespace shared with the broker sheet's `broker_code`. */
  @IsString()
  @Length(1, 40)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message:
      'code must be upper-case letters, digits, hyphen or underscore — it is an identifier people type and quote, not a label',
  })
  code!: string;

  /** #3 */
  @IsString()
  @Length(1, 200)
  legalNameAr!: string;

  /** #4 */
  @IsString()
  @Length(1, 200)
  legalName!: string;

  /** #5 — the short name a quotation or a policy schedule prints. */
  @IsString()
  @Length(1, 50)
  shortName!: string;

  /** #6 */
  @IsUUID()
  legalFormId!: string;

  /** #7 — unique platform-wide AND across organization types, so one establishment cannot be
   *  registered once as an office and once as a company. */
  @IsString()
  @Length(1, 40)
  nationalEstablishmentNo!: string;

  /** #8 */
  @IsString()
  @Length(1, 40)
  commercialRegistrationNo!: string;

  /** #9 */
  @IsString()
  @Length(1, 40)
  taxNumber!: string;

  // ------------------------------------------------------------- licensing and activity (#10-#14)

  /** #10 — `Organization.insurerLicenseNumber`. A SINGLE number, not a series of terms: the insurer
   *  sheet carries no issue or expiry date, unlike the broker sheet, so there is no term to model. */
  @IsString()
  @Length(1, 40)
  insurerLicenseNumber!: string;

  /** #11 */
  @IsUUID()
  licensingAuthorityId!: string;

  /** #13 — conventional, takaful, or a takaful window. A TABLE, not an enum, and nothing branches on
   *  it: the terminology templates that will differ by model are item (e)'s declared deferral. */
  @IsUUID()
  businessModelId!: string;

  /**
   * #14 `licensed_lines` — the lines this company's licence permits it to UNDERWRITE.
   *
   * NOT the same fact as `InsurerDirectory.lines`, which is what offices have recorded BUYING, and
   * the two are never reconciled — see the two-source rule in `docs/deferred-register.md`.
   *
   * Standard catalogue ids only. An office's own additional line is an office concept; a regulator
   * does not license anybody for a line one brokerage invented.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  licensedLineIds!: string[];

  /** #38 — the licence certificate. Its own `DocumentCategory` value, never the broker's: the two
   *  licences are different instruments under art. 82 of Law No. 12 of 2021. */
  @IsString()
  @Length(1, 400)
  certificateFileName!: string;

  @IsString()
  @Length(1, 500)
  certificateStorageRef!: string;

  // -------------------------------------------------------------- address and contact (#17-#24)

  @IsUUID()
  countryId!: string;

  @IsUUID()
  cityId!: string;

  @IsString()
  @Length(1, 300)
  address!: string;

  @IsString()
  @Length(1, 40)
  phone!: string;

  @IsEmail()
  @Length(1, 150)
  email!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  website?: string;

  /** #23, #24 — PUBLISHED CHANNELS and therefore company facts, unlike the named people in #25-#27.
   *  A broker sends a quotation request to the company's quotations mailbox, not to a person. */
  @IsEmail()
  @Length(1, 150)
  quotationEmail!: string;

  @IsEmail()
  @Length(1, 150)
  claimsEmail!: string;

  // ------------------------------------------------------------------ integration (#28-#29)

  /** #28 */
  @IsIn(['API', 'PORTAL', 'EMAIL', 'MANUAL'])
  integrationMethod!: 'API' | 'PORTAL' | 'EMAIL' | 'MANUAL';

  /**
   * #29 — «إلزامي شرطي» on the sheet, and the condition is #28 being `API`.
   *
   * OPTIONAL HERE AND DECIDED IN THE SERVICE, which is item (e)'s own lesson about `@IsOptional()`:
   * it installs a condition that skips every validator on its property when the value is ABSENT, so a
   * rule about a field's absence can never fire on the field it is about. The service sees both
   * fields and always runs.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 300)
  apiEndpoint?: string;

  // ---------------------------------------------------------------------- banking (#30-#31)

  @IsUUID()
  bankId!: string;

  /** #31 — encrypted at rest, like the brokerage office's. */
  @IsString()
  @Length(15, 34)
  iban!: string;

  // --------------------------------------------------------------- not on the sheet, but required

  /** How the platform addresses this tenant. `NOT NULL UNIQUE` since multi-tenancy Phase 1. */
  @IsString()
  @Length(2, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      'subdomain must be lower-case letters, digits and hyphens, and may not start or end with a hyphen',
  })
  subdomain!: string;
}
