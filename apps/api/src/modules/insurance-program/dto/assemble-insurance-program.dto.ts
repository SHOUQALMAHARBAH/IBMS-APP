import { IsUUID } from 'class-validator';

/** Process 7 — assemble a multi-line Insurance Program from the
 * risk-assessment results. The input is the APPROVED Needs Assessment whose
 * `recommendedCoverageLines` form the program's spine; its parent Risk
 * Profile (and that profile's asset survey) supply the per-line Sum Insured
 * basis. The program hangs off that same Risk Profile
 * (`InsuranceProgram.riskProfileId`), resolved server-side — never
 * caller-supplied. */
export class AssembleInsuranceProgramDto {
  @IsUUID()
  needsAssessmentId!: string;
}
