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
import { IsCalendarDate } from '../../../common/is-calendar-date.validator';

/**
 * MODULE 0-ب ITEM (d) — REGISTERING A BROKERAGE OFFICE. The corrected field dictionary's broker
 * sheet («الوسيط»), 47 fields, in its own groups and its own order.
 *
 * ## WHAT IS HERE AND WHAT DELIBERATELY IS NOT
 *
 * Four of the 47 are never typed, and leaving them off is the decision rather than an omission:
 *
 *   * **#1 `broker_id`** — the primary key, generated.
 *   * **#16 `license_status_id`** — DERIVED. Decision 71, and the dictionary's own correction 3:
 *     «حالة الترخيص لا تُخزَّن». There is no column and there must not be one; see
 *     `license-standing.config.ts`.
 *   * **#44 licensed insurance TYPES** — DERIVED from the categories of the branches in #17.
 *     Decision 67, and correction 4 restates it. A type field here would be a second home for a
 *     fact the catalogue already answers.
 *   * **#38–42 `status` / `created_at` / `created_by` / `updated_at` / `updated_by`** — written by
 *     the server. A caller who could set `created_by` could attribute the registration of a tenant
 *     to somebody else.
 *
 * One field here is NOT on the sheet: `subdomain`. It is how this platform addresses a tenant, it is
 * `NOT NULL UNIQUE` on `Organization`, and no registration can omit it. It is named as an addition
 * in `docs/module-0b-field-map.md` rather than quietly folded in with the 47.
 *
 * ## THE FOUR REFUSALS THIS DTO DOES *NOT* MAKE
 *
 * The duplicate establishment number, the missing certificate, a natural person given two types,
 * and the capital shortfall are all decided in `OfficeRegistrationService`, inside the one
 * transaction — not here. Two reasons, and the first is item (e)'s lesson repeated:
 *
 *   * `@IsOptional()` installs a condition that SKIPS every validator on its property when the value
 *     is absent, so a rule about a field's ABSENCE can never fire on the field it is about. That
 *     bit item (e) and the cure was the same one: put it where it always runs.
 *   * three of the four need the DATABASE (is this number taken, do these branches span two
 *     categories, what does the catalogue say these lines are). A DTO cannot ask.
 *
 * What this class does is reject malformed input before any of that, so a 400 about a field name
 * never arrives as a 500 from a NOT NULL violation.
 */
export class RegisterBrokerageOfficeDto {
  // ------------------------------------------------------------------ basic identity (#2-#10)

  /** #2 `broker_code` — unique PLATFORM-WIDE and shared with the insurer sheet's `insurer_code`.
   *  One column, one namespace: see `docs/module-0b-field-map.md` § C.1, where that is recorded as
   *  a decision and not a reading of the sheet. */
  @IsString()
  @Length(1, 40)
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/, {
    message:
      'code must be upper-case letters, digits, hyphen or underscore — it is an identifier people type and quote, not a label',
  })
  code!: string;

  /** #3. MANDATORY on the sheet and NOT NULL in the schema since this module tightened it — measured
   *  first: zero existing rows lacked one, which is what made the tightening safe. */
  @IsString()
  @Length(1, 200)
  legalNameAr!: string;

  /** #4 */
  @IsString()
  @Length(1, 200)
  legalName!: string;

  /** #5 */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 150)
  tradeName?: string;

  /** #6 — a row of the provider-maintained `LegalForm` list. `SOLE_ESTABLISHMENT` is the one art.
   *  10/a/1/a requires for a natural-person broker, and the sheet does not list it; the seed does. */
  @IsUUID()
  legalFormId!: string;

  /** #7 — THE DUPLICATE-REGISTRATION DEFENCE. Unique platform-wide AND across organization types, so
   *  the same establishment cannot be registered once as an office and once as an insurer. The
   *  database holds that; the service turns the collision into a sentence. */
  @IsString()
  @Length(1, 40)
  nationalEstablishmentNo!: string;

  /** #8 */
  @IsString()
  @Length(1, 40)
  commercialRegistrationNo!: string;

  /** #9 — optional on the sheet. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsCalendarDate()
  commercialRegistrationDate?: string;

  /** #10 */
  @IsString()
  @Length(1, 40)
  taxNumber!: string;

  // ------------------------------------------------------------------------- licence (#11-#17)

  /**
   * #11 `license_type_id`. A DIFFERENT AXIS from the life/general types derived from the branches,
   * and the two are never merged — recorded in the field map at § 1.1 and kept apart here by having
   * no shared vocabulary at all.
   */
  @IsIn(['DIRECT', 'REINSURANCE'])
  brokerageKind!: 'DIRECT' | 'REINSURANCE';

  /** #12 — the term's number. */
  @IsString()
  @Length(1, 200)
  licenseNumber!: string;

  /** #13 */
  @IsUUID()
  licensingAuthorityId!: string;

  /** #14 */
  @IsCalendarDate()
  licenseIssuedAt!: string;

  /**
   * #15. Art. 10/b requires a term ending 31 December, with the year of issue counting as a whole
   * year however late in it the licence was granted. Entered as PRINTED ON THE CERTIFICATE and
   * WARNED about rather than refused when it disagrees — the certificate is the authority, and a
   * registration refused over a date somebody copied correctly is a refusal with nowhere to go.
   */
  @IsCalendarDate()
  licenseExpiresAt!: string;

  /** #46 — the certificate, mandatory. `certificateDocumentId` is NOT NULL on `BrokerLicense`: a
   *  term recorded with no certificate behind it records a claim rather than a fact. */
  @IsString()
  @Length(1, 400)
  certificateFileName!: string;

  /** #46, second half. NOTE, so the requirement is not read as more than it is: this application has
   *  no object storage, so this names a location nothing can fetch. What it buys is that the
   *  certificate is FILED AND ATTRIBUTED, not that the bytes are retrievable. */
  @IsString()
  @Length(1, 500)
  certificateStorageRef!: string;

  /** #47 — conditionally mandatory on the sheet, and the condition is "a renewal has been filed".
   *  Optional at registration: a brand-new office has filed none. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsCalendarDate()
  renewalRequestedAt?: string;

  /**
   * #17 `licensed_lines` — ids from the GLOBAL 32-line catalogue (27 general, 5 life). The licence
   * TYPES are the distinct categories of these rows and are never entered (#44, decision 67).
   *
   * At least one, because art. 3/a's one-type rule and art. 4/a's capital bands are both functions
   * of the scope, and an office licensed for nothing is not something this form should be able to
   * produce quietly.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  licensedLineIds!: string[];

  // -------------------------------------------------------------- address and contact (#18-#23)

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

  // ------------------------------------------------------- the art. 10/a registration pack (#48-#49)

  /**
   * DECISION 88 — ART. 10/a/2 and ART. 10/a/3, BOTH OPTIONAL, AND THE OPTIONALITY IS THE DECISION.
   *
   * «نسخة عن عقد الإيجار أو سند الملكية للمقر الخاص به» and «ما يثبت انتساب ... إلى الجمعية الأردنية
   * لوسطاء التأمين». Mandatory in the article, and ABSENCE DOES NOT BLOCK THE SAVE here.
   *
   * That is not a relaxation of the regulation. An office licensed by the Central Bank DID submit
   * these to the regulator — that is what being licensed means — so refusing to record a licensed
   * office until WE hold our own copy would be refusing a fact in favour of our filing. What happens
   * instead is that the registration pack is derived as INCOMPLETE and the marker names what is
   * missing, in words that state what we hold and never a finding about the office.
   *
   * Do not reason from `certificateFileName` above, which IS required: that one is required because
   * `BrokerLicense.certificateDocumentId` is NOT NULL, which was discovered rather than chosen.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 400)
  premisesTenureFileName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 500)
  premisesTenureStorageRef?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 400)
  associationMembershipFileName?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 500)
  associationMembershipStorageRef?: string;

  // ------------------------------------------------------------------- key people (#24-#27)

  /**
   * All four are PERSONAL DATA under PDPL No. 24/2023 and are TEXT at registration, never foreign
   * keys — § 1.8 of the field map. A natural person named here does not yet have an `Employee` row
   * or a login, and inventing one would create a data subject nobody asked to create.
   */
  @IsString()
  @Length(1, 150)
  generalManagerName!: string;

  @IsString()
  @Length(1, 150)
  complianceOfficerName!: string;

  @IsEmail()
  @Length(1, 150)
  complianceOfficerEmail!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 40)
  complianceOfficerPhone?: string;

  // ------------------------------------------------------ regulatory guarantees (#28-#34, #43, #45)

  /**
   * #28-#31 — ALL OPTIONAL, and the dictionary's correction 1 is why:
   *
   *   «لا ترد الكفالة البنكية في تعليمات البنك المركزي رقم (٩) لسنة ٢٠٢٦. تُجمَع إن وُجدت، ولا
   *    تُطلَب، ولا يُرفَض مكتبٌ لغيابها، ولا تُسمّى متطلباً تنظيمياً.»
   *
   * Verified by reading arts. 3, 4, 10, 11, 13, 15 and 18: the bank guarantee appears in none of
   * them. It is collected if the office has one, never required, never a reason to refuse, and never
   * labelled a regulatory requirement anywhere in this product.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 40)
  bankGuaranteeNo?: string;

  @IsOptional()
  @IsUUID()
  bankGuaranteeBankId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{1,15}(\.\d{1,3})?$/, {
    message:
      'bankGuaranteeAmount must be a JOD amount with at most three decimal places (fils)',
  })
  bankGuaranteeAmount?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsCalendarDate()
  bankGuaranteeExpiry?: string;

  /**
   * #32-#34 — PROFESSIONAL INDEMNITY, MANDATORY WITHOUT CONDITION. Correction 2, and both citations
   * verified: art. 10/a/4 requires the cover before the licence is finally approved, and art. 18/a/3
   * puts it in the periodic returns.
   *
   * NO MINIMUM LIMIT IS ENFORCED and none is invented. Art. 10/a/4 leaves «شروط ومتطلبات هذا العقد»
   * to a CBJ decision this project does not have, so the limit is collected and never compared.
   */
  @IsString()
  @Length(1, 40)
  piPolicyNumber!: string;

  /**
   * NOT ON THE SHEET, AND REQUIRED BY THE SCHEMA. `ProfessionalIndemnityPolicy.insurerName` is NOT
   * NULL and predates this module by a year — the model was built for an office recording its OWN
   * cover, where the insurer is the first thing anybody asks about a policy.
   *
   * Recorded as an addition in `docs/module-0b-field-map.md` rather than quietly folded into the 47,
   * and taken as TEXT rather than an `Insurer` FK deliberately: the office's PI insurer is a company
   * on the broker's own books, and at registration the office has no books.
   */
  @IsString()
  @Length(1, 200)
  piInsurerName!: string;

  @Matches(/^\d{1,15}(\.\d{1,3})?$/, {
    message:
      'piCoverageLimit must be a JOD amount with at most three decimal places (fils)',
  })
  piCoverageLimit!: string;

  @IsCalendarDate()
  piExpiresAt!: string;

  /** #43 — art. 3/a's axis: a sole establishment is one natural person and may hold ONE insurance
   *  type; a company may hold both. The refusal lives in the service, where the branches are known. */
  @IsIn(['NATURAL_PERSON', 'CORPORATE'])
  brokerKind!: 'NATURAL_PERSON' | 'CORPORATE';

  /**
   * #45 `paid_up_capital_per_type`. ONE figure, and the "per type" half is the REQUIREMENT rather
   * than the holding: art. 4/a's bands are computed per type from the branch counts and SUMMED, so
   * an office licensed for both types sees a requirement built from two bands and one capital figure
   * measured against it.
   *
   * Optional — and that is a deliberate difference from the sheet's «إلزامي». A missing capital
   * figure and a capital figure below the requirement are DIFFERENT FACTS, and `assessCapital`
   * already keeps them apart (`capitalIsUnrecorded`) precisely so a screen cannot tell an office it
   * is undercapitalised when nobody has typed the number. Requiring it here would collapse the
   * distinction at the only point where it can still be made honestly.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @Matches(/^\d{1,15}(\.\d{1,3})?$/, {
    message:
      'paidUpCapital must be a JOD amount with at most three decimal places (fils)',
  })
  paidUpCapital?: string;

  // ------------------------------------------------------------------------- banking (#35-#37)

  @IsUUID()
  bankId!: string;

  /** #36 — ENCRYPTED at rest (`Organization.ibanEnc`). The first bank-account column anywhere in
   *  this schema; measured before adding it that none existed. */
  @IsString()
  @Length(15, 34)
  iban!: string;

  @IsUUID()
  currencyId!: string;

  // --------------------------------------------------------------- not on the sheet, but required

  /**
   * HOW THE PLATFORM ADDRESSES THIS TENANT. `NOT NULL UNIQUE` on `Organization` since multi-tenancy
   * Phase 1, so no registration can omit it. Named as an addition in the field map rather than
   * folded in with the 47 — the dictionary describes a brokerage, not this platform's addressing.
   */
  @IsString()
  @Length(2, 63)
  @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message:
      'subdomain must be lower-case letters, digits and hyphens, and may not start or end with a hyphen',
  })
  subdomain!: string;
}
