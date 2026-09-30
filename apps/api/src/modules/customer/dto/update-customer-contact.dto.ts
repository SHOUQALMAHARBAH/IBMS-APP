import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * Correcting a customer's CONTACT details — `PATCH /customers/:id` (`customer.update`).
 *
 * ## The three fields, and why only three
 *
 * `IMPROVEMENTS.md` § 3.14 measured that a customer record has no update path at all, which is also why a
 * PDPL CORRECTION request can only be closed by a staff member attesting to a change the system gives them
 * no way to make. These three carry no regulatory consequence, so they are correctable now and
 * unconditionally.
 *
 * ## WHAT THIS DTO REFUSES, AND WHY THE REFUSAL IS STRUCTURAL
 *
 * Name, date of birth, nationality, place of birth, national ID, passport and beneficial owner are ABSENT
 * from this class, and `forbidNonWhitelisted` therefore rejects them with a 400 naming the field. That is
 * deliberate and it is the design, not an omission:
 *
 * Jordan's Anti-Money Laundering Unit requires screening "Upon any updates to the Local Terrorist List or
 * UN Consolidated List … Prior to onboarding new customers … Upon KYC reviews or CHANGES TO A CUSTOMER'S
 * INFORMATION … Before processing any transaction", and requires the other identifiers to resolve a
 * potential match: "further search should be made with the other identifiers (full name, date of birth,
 * nationality)".
 *
 *   https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
 *
 * So changing one of those fields is a SCREENING EVENT, not an edit. The owner's ruling: the re-screening
 * mechanism is the precondition for editing them at all — they ship with it and never without it. Leaving
 * them out of this class is what makes that a property of the code rather than a rule somebody has to
 * remember; a field added here without the mechanism would be a silent relaxation of a control.
 *
 * ## `registeredAddress` is CORPORATE only
 *
 * Mirroring `CreateCustomerDto`, where the service writes it only for a corporate customer. An individual's
 * address is not a column this model has, so accepting it here and dropping it would be a field that looks
 * saved and is not — the service refuses it with a 422 instead.
 */
export class UpdateCustomerContactDto {
  /** Re-encrypted on write. Omit to leave unchanged; there is deliberately no way to clear it to null
   *  through this route, because "no phone number" and "do not change the phone number" must not be the
   *  same request. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(3, 40)
  contactPhone?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(3, 200)
  contactEmail?: string;

  /** Corporate customers only — the service refuses it on an individual. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(3, 500)
  registeredAddress?: string;

  /**
   * Why the correction was made. OPTIONAL here, deliberately.
   *
   * The owner's ruling is that these three are correctable "now, unconditionally", and a mandatory
   * justification on fixing a phone number is friction on the commonest case in the product. The
   * identifier corrections are a different matter — there the reason is part of the record the AMLU
   * requires to be retained, and it will be mandatory.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(3, 500)
  reason?: string;

  /**
   * The Data Subject Request this correction answers, if it answers one.
   *
   * Present so the attestation that closes a CORRECTION request has evidence behind it rather than only a
   * staff member's word — the same argument that writes a `CombinedDutyAct` before the write it excuses.
   * A plain reference for now: making the DSR closure DEPEND on a recorded change is the owner's open
   * question 2 in `docs/decision-correcting-a-customers-details.md`, and this is the field that answer
   * will read.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(['dsr'])
  answersRequestType?: 'dsr';

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 100)
  answersRequestId?: string;
}
