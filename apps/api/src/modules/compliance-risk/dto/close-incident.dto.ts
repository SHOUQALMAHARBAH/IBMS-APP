import { IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';

/**
 * Process 55 — `POST /incidents/:id/close` (`incident.contain`) — backlog
 * #55's first checkbox: "Closed (root cause mandatory)." Required, not
 * optional — the model's own field comment says as much.
 */
export class CloseIncidentDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `rootCauseAnalysis ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  rootCauseAnalysis!: string;
}
