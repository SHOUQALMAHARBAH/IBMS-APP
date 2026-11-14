import type { Article15DExemption } from '@ibms/db';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimIfString } from '../../../common/dto.util';

/*
 * ⚠️ THE NESTED DTOs ARE DECLARED BEFORE `CreateRfqDto`, AND THAT IS NOT STYLE.
 *
 * `@Type(() => Article15DChoiceDto)` is evaluated when `CreateRfqDto`'s class body is built, not
 * when a request arrives — so a class declared BELOW it is in its temporal dead zone and the
 * module throws `Cannot access 'Article15DChoiceDto' before initialization` AT IMPORT TIME.
 *
 * ⟶ TypeScript could not see it: the decorator's arrow function is well-typed either way. It
 *   failed at BOOT, taking every e2e in the api suite with it rather than only the one under
 *   test — the same class of RUNTIME-only failure a missing Nest provider is.
 */
/** The declaration itself — only when NO exemption applies. */
export class Article15DDeclarationDto {
  /**
   * The written justification. The floor is enforced in `DeclaredActService` against
   * `DECLARATION_REASON_MIN_LENGTH`, which has ONE home, and again by
   * `DeclaredAct_reason_meets_the_shared_floor` in SQL.
   *
   * ⛔ NOT re-declared as `@MinLength(10)` here. A third copy of that number is exactly the drift
   * `declaration-reason.ts` exists to prevent, and `check:declaration-floor` would refuse it.
   */
  @Transform(trimIfString)
  @IsString()
  @MaxLength(2000)
  reason!: string;

  /** Element 4: the acknowledgement is ticked BY HAND. An unticked one is not a weaker
   *  declaration, it is no declaration — the service refuses it by name. */
  @IsBoolean()
  acknowledged!: boolean;
}

export class Article15DChoiceDto {
  /** One of art. 15/d's five. Absent means none applies, which is what opens the window. */
  @IsOptional()
  @IsIn([
    'INDIVIDUAL_MEDICAL_RENEWAL',
    'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS',
    'DEFINED_BENEFIT_CONTRACT',
    'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
    'AT_CUSTOMER_REQUEST',
  ])
  exemption?: Article15DExemption;

  /**
   * Exemption 4 only — the premium the employee EXPECTS and declares, never one a quotation
   * returned. A STRING, because `money-decimal-jod.md` forbids a JOD figure as a JS number: the
   * difference between 2000 and 2000.001 is the difference between qualifying and not.
   */
  @IsOptional()
  @IsNumberString()
  declaredAnnualPremiumJod?: string;

  /** Exemption 5 only — an INBOUND `CommunicationLog` that arrived by an approved means. */
  @IsOptional()
  @IsUUID()
  evidenceCommunicationLogId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Article15DDeclarationDto)
  declaration?: Article15DDeclarationDto;
}

/** Process 11 — create one RFQ for one insurance line under an Opportunity
 * and send it to a shortlist of insurers. Each shortlisted insurer becomes a
 * SENT `RFQInsurer` row. `followUpThresholdDays` overrides the column
 * default (9) for this RFQ's follow-up sweep; omit to take the default. */
export class CreateRfqDto {
  @IsUUID()
  opportunityId!: string;

  @Transform(trimIfString)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  insuranceLine!: string;

  /** The insurer shortlist. At least one, de-duplicated server-side; every
   * id must resolve to a real Insurer (422 otherwise). */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  insurerIds!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  followUpThresholdDays?: number;

  /**
   * ART. 15/d — what this request rests on when it goes to fewer than three insurance companies.
   *
   * OPTIONAL, and that is the point: OWNER DECISION 130 ruling 1 says the office sends to three
   * or more BECAUSE THAT IS WHAT THE LAW SAYS, so this is absent on the overwhelming majority of
   * requests (84.3% on the seeded distribution) and the DTO must not make every caller think
   * about it. The server decides whether it was needed — a client cannot be trusted to, and a
   * request carrying one it did not need is refused rather than stored.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => Article15DChoiceDto)
  article15D?: Article15DChoiceDto;
}
