import { IsIn, IsString, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NO_FULL_ACCOUNT_NUMBER,
  NO_FULL_ACCOUNT_NUMBER_MESSAGE,
  trimIfString,
} from '../../../common/dto.util';
import { INCIDENT_SEVERITIES } from '../incident.config';

/**
 * Process 55 — `POST /incidents` (`incident.report` — deliberately broad:
 * Sales/Placement/Claims/Finance/Compliance/Manager/Admin/DPO, since any
 * employee may be the first to notice a security/privacy incident).
 * `reportedAt` is never caller-suppliable — always `new Date()` at create
 * time, the DSR `receivedAt` shape: the containment/notification SLA clocks
 * start from it, so backdating would let staff artificially extend their
 * own SLA window.
 */
export class CreateIncidentDto {
  @Transform(trimIfString)
  @IsString()
  @Length(1, 300)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `title ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  title!: string;

  @Transform(trimIfString)
  @IsString()
  @Length(1, 4000)
  @Matches(NO_FULL_ACCOUNT_NUMBER, {
    message: `description ${NO_FULL_ACCOUNT_NUMBER_MESSAGE}`,
  })
  description!: string;

  @IsIn(INCIDENT_SEVERITIES, {
    message: `severity must be one of: ${INCIDENT_SEVERITIES.join(', ')}`,
  })
  severity!: string;
}
