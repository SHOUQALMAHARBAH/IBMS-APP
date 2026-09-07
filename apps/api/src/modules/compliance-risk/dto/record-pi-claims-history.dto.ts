import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 53-54 — `POST /pi-policy/:id/claims-history` (`pi-policy.manage` /
 * Compliance). Overwrites a PI policy record's claims-history summary as new
 * claims information comes in — full-replace, not append; the `UPDATE`
 * audit row (before/after) is the history of how the summary changed over
 * time, not a bespoke revision field on the model.
 */
export class RecordPiClaimsHistoryDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `claimsHistorySummary ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  claimsHistorySummary!: string;
}
