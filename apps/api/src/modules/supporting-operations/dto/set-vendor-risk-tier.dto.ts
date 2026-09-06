import { IsIn } from 'class-validator';
import { RISK_TIERS, type RiskTier } from '../vendor.config';

/** Process 71 — `PATCH /vendors/:id/risk-tier` (`vendor.manage`). A
 * dedicated action, not folded into the generic `PATCH /vendors/:id` —
 * tiering a vendor Medium/High has a real side effect (auto-scheduling the
 * annual-review SLA), which deserves its own auditable entry point. */
export class SetVendorRiskTierDto {
  @IsIn(RISK_TIERS, {
    message: `riskTier must be one of: ${RISK_TIERS.join(', ')}`,
  })
  riskTier!: RiskTier;
}
