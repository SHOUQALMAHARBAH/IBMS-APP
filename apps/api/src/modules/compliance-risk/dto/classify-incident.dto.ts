import { IsIn } from 'class-validator';

/**
 * Process 55 — `POST /incidents/:id/classify` (`incident.classify`). Must
 * be a Data Protection Officer specifically (checked in the service, not
 * just the coarse permission — `incident.classify` is ALSO held by
 * Executive Management, whose distinct role is the separate co-sign step).
 */
export class ClassifyIncidentDto {
  @IsIn(['MATERIAL', 'NON_MATERIAL'], {
    message: 'classification must be MATERIAL or NON_MATERIAL',
  })
  classification!: 'MATERIAL' | 'NON_MATERIAL';
}
