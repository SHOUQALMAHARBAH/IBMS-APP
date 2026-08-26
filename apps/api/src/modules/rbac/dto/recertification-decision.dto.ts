import { IsIn } from 'class-validator';
import type { RecertificationDecision } from '../services/access-recertification.service';

export class RecertificationDecisionDto {
  @IsIn(['confirmed', 'revoked', 'changed'])
  decision!: RecertificationDecision;
}
