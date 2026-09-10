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

  /** Part B §17. The written acceptance of a REVIEW_REQUIRED screening hold.
   * Optional here because most files carry no hold at all; when one is in
   * force, `ScreeningHoldService` refuses the approval without it. Never
   * releases a BLOCKED hold — nothing does. */
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  screeningHoldReason?: string;
}
