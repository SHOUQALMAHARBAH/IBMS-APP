-- Backlog Part C #16 — Broker Recommendation. The `Recommendation` and
-- `ConflictOfInterestDisclosure` models already existed (big migration
-- 20260825124114) plus the `Recommendation_maker_checker_distinct` CHECK
-- (20260826091424, approvedByUserId <> draftedByUserId). This migration adds
-- the fields #16 needs.

-- 1. Structured, per-dimension rationale (the backlog enumerates six
--    factors). NOT NULL — a recommendation must address every dimension, not
--    just price. The table is empty (Domain B stops at #15 today), so the
--    add-with-default / drop-default two-step is belt-and-braces.
ALTER TABLE "Recommendation" ADD COLUMN "rationaleFactors" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Recommendation" ALTER COLUMN "rationaleFactors" DROP DEFAULT;

-- 2. Draft-time snapshots of the two gates + provenance for the send step.
ALTER TABLE "Recommendation" ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Recommendation" ADD COLUMN "conflictOfInterestFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Recommendation" ADD COLUMN "coiCompetingQuotationId" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN "coiCommissionDiffPercent" DECIMAL(5,2);
ALTER TABLE "Recommendation" ADD COLUMN "sentByUserId" TEXT;

-- 3. Filter / FK indexes.
CREATE INDEX "Recommendation_draftedByUserId_idx" ON "Recommendation"("draftedByUserId");
CREATE INDEX "ConflictOfInterestDisclosure_competingQuotationId_idx" ON "ConflictOfInterestDisclosure"("competingQuotationId");
