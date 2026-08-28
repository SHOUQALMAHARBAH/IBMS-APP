import { IsUUID } from 'class-validator';

/** Process 11 — create an Opportunity (a specific placement need) from a
 * FINALIZED Insurance Program. The Program is the only input: its parent
 * Risk Profile's Customer becomes the Opportunity's `customerId`, resolved
 * server-side — never caller-supplied. The full Opportunity lifecycle
 * (client decision, renegotiation, close-lost) is Processes 16-17. */
export class CreateOpportunityDto {
  @IsUUID()
  insuranceProgramId!: string;
}
