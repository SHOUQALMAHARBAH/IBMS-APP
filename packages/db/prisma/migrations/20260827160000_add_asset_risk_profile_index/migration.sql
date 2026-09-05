-- Part C backlog #6 (Risk Assessment) — the asset survey screen and the Sum
-- Insured derivation both fetch an Asset set by its parent RiskProfile
-- (RiskProfileService via RiskProfileRepository.findAssetsByRiskProfileId /
-- findAssetsByCustomerId), the same parent-FK filter every other child table
-- in this schema already indexes (ScreeningResult.kycRecordId,
-- Interaction.customerId, KYCRecord.customerId, ...). Asset was the one child
-- table without it. Additive index only — no data or type change.

-- CreateIndex
CREATE INDEX "Asset_riskProfileId_idx" ON "Asset"("riskProfileId");
