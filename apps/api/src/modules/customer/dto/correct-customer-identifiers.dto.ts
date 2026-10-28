import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined, trimIfString } from '../../../common/dto.util';
import { DECLARATION_REASON_MIN_LENGTH } from '../../../common/declaration-reason';
import { IsDateOfBirth, IsNationality } from './screening-identity.dto-parts';

/**
 * Correcting a customer's DATE OF BIRTH or NATIONALITY — `PATCH /customers/:id/identifiers`
 * (`customer.update`), INDIVIDUAL customers only.
 *
 * ## THIS IS A NARROW STRIKE OF THE 2026-09-28 DEFERRAL, BY THE OWNER, AND THE OTHER SIX STAY REFUSED
 *
 * That deferral's safety condition 1 is *the screening identifiers stay uneditable*, and it held at three
 * layers. Her ruling of 2026-10-28 strikes it for these TWO FIELDS ONLY:
 *
 *   > `dateOfBirth` and `nationality` become correctable through `CustomerIdentifierCorrection`.
 *   > `legalName`, the four name parts, `nationalId` and `registrationNumber` stay exactly as the
 *   > 2026-09-28 deferral left them — do not build, do not extend.
 *
 * Her reason: what she refused in September was an UNGUARDED edit of a screening identifier, and the
 * controlled path did not exist then. What exists now records who changed it and when, keeps the before and
 * after, demands a written reason, and re-screens.
 *
 * ## WHY THIS IS A SEPARATE CLASS RATHER THAN TWO MORE FIELDS ON `UpdateCustomerContactDto`
 *
 * Because condition 1's first layer is that `UpdateCustomerContactDto` declares only three fields and
 * `forbidNonWhitelisted` refuses everything else with a 400 naming the field. Adding two identifiers there
 * would weaken that layer **for all six of the fields the deferral still covers** — the class would no
 * longer be the thing that makes the refusal structural, and a seventh field added later by somebody being
 * helpful would look like the sixth.
 *
 * A separate class keeps the refusal exactly where it was. `customer.e2e-spec.ts` still refuses the
 * identifiers one at a time on `PATCH /customers/:id`; what changed is that two of them now have somewhere
 * else to go, and `nationalId`, `legalName` and the name parts still have nowhere at all.
 *
 * ## THE REASON IS MANDATORY HERE AND OPTIONAL ON THE CONTACT ROUTE
 *
 * `UpdateCustomerContactDto.reason` is optional and its own comment says why: *"a mandatory justification
 * on fixing a phone number is friction on the commonest case in the product. The identifier corrections are
 * a different matter — there the reason is part of the record the AMLU requires to be retained, and it will
 * be mandatory."* This is that class, so it is mandatory.
 *
 * The FLOOR is `DECLARATION_REASON_MIN_LENGTH` (ten) and that is derived rather than chosen. This
 * codebase has two measured minimums for a written reason: ten for a DECLARATION — a reason somebody gives
 * for their own act — and three for a NOTE. An officer justifying their own correction of a screening
 * discriminator is the first shape. (The DSR intake's `requestText` floor is three for the opposite
 * reason: it is a TRANSCRIPTION of what another person asked, and a request may legitimately be brief.)
 */
export class CorrectCustomerIdentifiersDto {
  /**
   * `YYYY-MM-DD`. Omit to leave unchanged — there is deliberately no way to clear either field to null
   * through this route, because "this person has no recorded date of birth" and "do not change the date of
   * birth" must not be the same request, and clearing a screening discriminator would silently return the
   * file to name-only matching.
   */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsDateOfBirth()
  dateOfBirth?: string;

  /** ISO 3166-1 alpha-2, upper case. Same validator as the create path and the UBO — one home. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsNationality()
  nationality?: string;

  /**
   * MANDATORY, unlike the contact route's. Part of the record the AMLU requires retained: *"the entity
   * must keep the verification mechanism and actions taken regarding the case in internal records"*.
   *
   * `@Transform(trimIfString)` BEFORE `@Length`, which is the order and not a detail — trimming after
   * validation lets ten spaces satisfy a ten-character floor and stores an empty reason. That defect
   * shipped on the DSR intake's `requestText` one batch ago and its own e2e caught it.
   */
  @Transform(trimIfString)
  @IsString()
  @Length(DECLARATION_REASON_MIN_LENGTH, 500)
  reason!: string;

  /**
   * The Data Subject Request this correction answers, if it answers one.
   *
   * This is what makes a PDPL CORRECTION request about a date of birth ANSWERABLE rather than merely
   * attestable: `DsrService.fulfil` refuses to close a CORRECTION request with no correction recorded
   * against it, and `dsrId` on the correction row is the only link it can read. Before this route the
   * request types it could answer were phone, email and address — a data subject asking for their date of
   * birth to be corrected could have the request neither answered nor closed.
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
