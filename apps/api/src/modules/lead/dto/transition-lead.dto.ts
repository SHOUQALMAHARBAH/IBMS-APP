import { IsIn } from 'class-validator';
import { LeadStatus } from '@ibms/db';

export class TransitionLeadDto {
  @IsIn(Object.values(LeadStatus))
  toStatus!: LeadStatus;
}
