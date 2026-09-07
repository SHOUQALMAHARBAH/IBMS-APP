import { ArrayMinSize, ArrayUnique, IsIn } from 'class-validator';
import { INCIDENT_REGULATORS } from '../incident.config';

/**
 * Process 55 — `POST /incidents/:id/notify-regulators`
 * (`incident.notify-regulator`) — backlog #55's third checkbox: "since one
 * incident may trigger more than one regulator's obligations." At least one
 * regulator, no duplicates.
 */
export class NotifyRegulatorsDto {
  @ArrayMinSize(1, { message: 'regulators must name at least one regulator' })
  @ArrayUnique()
  @IsIn(INCIDENT_REGULATORS, {
    each: true,
    message: `each regulator must be one of: ${INCIDENT_REGULATORS.join(', ')}`,
  })
  regulators!: string[];
}
