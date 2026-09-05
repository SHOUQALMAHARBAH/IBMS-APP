import { IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';
import { INCIDENT_SEVERITIES } from '../incident.config';

const INCIDENT_STATUSES = [
  'REPORTED',
  'CONTAINED',
  'IMPACT_ASSESSED',
  'CLASSIFIED',
  'NOTIFIED',
  'RECOVERED',
  'CLOSED',
];
const INCIDENT_CLASSIFICATIONS = [
  'NOT_YET_CLASSIFIED',
  'MATERIAL',
  'NON_MATERIAL',
];

/** Process 55 — `GET /incidents?status=&severity=&classification=`. */
export class ListIncidentsQueryDto {
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(INCIDENT_STATUSES)
  status?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(INCIDENT_SEVERITIES)
  severity?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsIn(INCIDENT_CLASSIFICATIONS)
  classification?: string;
}
