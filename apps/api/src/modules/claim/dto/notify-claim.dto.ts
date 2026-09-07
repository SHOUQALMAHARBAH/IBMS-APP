import {
  IsBoolean,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MONEY_STRING, trimIfString } from '../../../common/dto.util';

/** Process 23 — the third party involved in the loss. Supplied only when
 * `isThirdPartyInvolved` is true; every field is optional (their details may
 * not be known at notification). `contactDetails` is field-level encrypted
 * into `ThirdPartyClaimant.contactDetailsEnc` (`-- ENCRYPT`). */
export class ClaimThirdPartyDto {
  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(500)
  contactDetails?: string;

  /** The subrogation / recovery flag — a distinct piece of state that drives
   * its own downstream process (`claims-lifecycle.md`). The recovery *amount*
   * is a settlement-phase figure and is not accepted at notification. */
  @IsOptional()
  @IsBoolean()
  subrogationRecoveryFlag?: boolean;
}

/**
 * Process 23 — record a claim notification against a Policy: the loss
 * date/location/cause, the estimated loss, and any third-party involvement.
 * The claim is created at `ClaimStatus.NOTIFIED`; coverage in force at the
 * exact loss date is validated server-side against the policy's
 * `PolicySchedule` version windows.
 */
export class NotifyClaimDto {
  @IsUUID()
  policyId!: string;

  /** When the loss occurred. A bare date or an offset-bearing datetime; must
   * not be in the future (a record of something that already happened). */
  @IsISO8601()
  lossDate!: string;

  /** What happened. Required — a notification with no stated cause is not
   * actionable. */
  @IsString()
  @Transform(trimIfString)
  @MinLength(3)
  @MaxLength(2000)
  causeOfLoss!: string;

  @IsOptional()
  @IsString()
  @Transform(trimIfString)
  @MinLength(1)
  @MaxLength(500)
  lossLocation?: string;

  /** The client's / notifier's estimate of the loss (fils precision, > 0). */
  @IsString()
  @Matches(MONEY_STRING, {
    message: 'estimatedLoss must be a decimal amount with at most 3 places',
  })
  estimatedLoss!: string;

  @IsOptional()
  @IsBoolean()
  isThirdPartyInvolved?: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClaimThirdPartyDto)
  thirdParty?: ClaimThirdPartyDto;
}
