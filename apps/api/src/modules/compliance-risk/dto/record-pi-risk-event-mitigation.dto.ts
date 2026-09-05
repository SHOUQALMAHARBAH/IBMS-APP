import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 54 — `POST /pi-risk-events/:id/mitigation` (`pi-policy.manage` /
 * Compliance). Sets or updates the mitigation action recorded against a PI
 * risk event — full-replace, the `RecordPiClaimsHistoryDto` shape.
 */
export class RecordPiRiskEventMitigationDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 2000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `mitigationAction ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  mitigationAction!: string;
}
