import { RenewalStatus } from '@ibms/db';
import { IsEnum } from 'class-validator';

/** Part 3.9 — move a renewal case through `WORKFLOW_TRANSITIONS.RenewalCase`.
 * The engine, not this DTO, decides whether the move is legal from where the
 * case currently is. */
export class TransitionRenewalCaseDto {
  @IsEnum(RenewalStatus)
  toStatus!: RenewalStatus;
}
