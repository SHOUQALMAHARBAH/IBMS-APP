import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { emptyStringToUndefined } from '../../../common/dto.util';

/** Process 5/6 — creates the minimal parent Risk Profile a Needs Assessment
 * (Process 5) hangs off. The detailed building/equipment/stock/fleet survey,
 * the per-asset declared values, and the Sum Insured / indemnity-period
 * derivation are Process 6 (Risk Assessment) — not built in this backlog
 * item; see README § Known gaps, Part C #5. */
export class CreateRiskProfileDto {
  @IsUUID()
  customerId!: string;

  /** For multi-site / multi-entity clients — one Risk Profile per location. */
  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 200)
  siteLabel?: string;

  @IsOptional()
  @Transform(emptyStringToUndefined)
  @IsString()
  @Length(1, 2000)
  priorClaimsHistorySummary?: string;
}
