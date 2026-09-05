import { IsOptional, IsString, Length } from 'class-validator';

/** Shared by both POST /kyc-records/:id/approve and .../reject
 * (kyc.approve — Compliance Officer's decision action). `reason` is
 * optional here at the DTO level but KycService enforces it as required on
 * a reject (a rejection with no stated reason is not a real decision). */
export class KycDecisionDto {
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}
