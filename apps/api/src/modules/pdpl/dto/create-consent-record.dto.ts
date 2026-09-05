import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ConsentPurpose } from '@ibms/db';
import { emptyStringToUndefined } from '../../../common/dto.util';

/**
 * M03 — `POST /consent-records` (`consent.manage`). Captures ONE consent
 * decision at a touchpoint — a grant (`granted: true`) or an explicit
 * decline (`granted: false`, still recorded: someone was asked and said no,
 * which the register must show, not silently drop). Pre-ticked boxes are
 * prohibited (`granted` defaults unchecked on the model; this DTO makes it
 * mandatory so a caller can never omit the decision and have it default to
 * "granted").
 *
 * Exactly one of `customerId` / `insuredPersonId` identifies the data
 * subject (validated in the service — `hasExactlyOneOwner`). `isMarketing`
 * is NOT accepted here — it is derived from `purpose` (`consent.config.ts`).
 */
export class CreateConsentRecordDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  insuredPersonId?: string;

  @IsIn(Object.values(ConsentPurpose))
  purpose!: string;

  @IsBoolean()
  granted!: boolean;

  /** The exact wording version presented at capture (`PRIV-FRM-04/05`'s
   * consent-text versioning) — e.g. `"privacy-notice-v1.2"`. Not free text
   * about the customer; a label identifying which approved text they saw. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  consentTextVersion!: string;
}
