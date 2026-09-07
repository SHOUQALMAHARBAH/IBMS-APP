import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  emptyStringToUndefined,
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 54 — `POST /pi-risk-events` (`pi-policy.manage` / Compliance). A
 * MANUAL log of a PI exposure that did not come through a Policy Checking
 * discrepancy (which auto-logs its own — see `pi-risk-event.config.ts`).
 * `piPolicyId` is optional: if omitted, the service auto-resolves it to
 * whichever PI policy is currently on record (the same default the
 * automatic discrepancy link uses), and stays `null` if none is configured
 * yet — there is no `sourcePolicyCheckingId` here; that field is set only
 * by the internal auto-link, never a caller input.
 */
export class CreatePiRiskEventDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `description ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  description!: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsUUID()
  piPolicyId?: string;
}
