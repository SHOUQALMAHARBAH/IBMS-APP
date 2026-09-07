-- Part C backlog #9 (Up-Selling, Domain A Process 9). Converts
-- UpSellRecommendation.status from a free-text String column ("open") to a
-- proper enum so UpSellRecommendation can plug into
-- WorkflowTransitionService (A.6) the same way LeadStatus / KycStatus /
-- NeedsAssessmentStatus / InsuranceProgramStatus / CrossSellStatus did (the
-- 5th such conversion). Values transcribe the model's own status comment:
--   OPEN      — the detection sweep flagged under-insurance (updated asset
--               value materially above the currently designed Sum Insured).
--   CONVERTED — a Sales Officer took the proposed increase forward (an
--               endorsement / re-quote — Process 22 / 11+, not built).
--   DISMISSED — the increase is not being pursued (with a reason).
--
-- Also adds provenance / resolution columns (same shape as #8's
-- CrossSellOpportunity):
--   * detectedByUserId — the actor behind the detection run: the system
--     service account for the nightly cron, the Sales Officer for an
--     on-demand scan. Bare scalar, no relation — the AuditLogEntry is the
--     authoritative trail.
--   * resolvedByUserId / resolvedAt — who converted/dismissed, and when.
--   * dismissReason — required by the API when dismissing; null otherwise.
--
-- UpSellRecommendation is empty in every environment this migration has been
-- applied to (Part C #9 is its first consumer — no code has ever written to
-- it), so the DROP COLUMN / ADD COLUMN rewrite loses no data and needs no
-- backfill. Same shape and safety argument as
-- 20260827200000_add_cross_sell_status_enum.

-- CreateEnum
CREATE TYPE "UpSellStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "UpSellRecommendation" DROP COLUMN "status",
ADD COLUMN     "status" "UpSellStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "detectedByUserId" TEXT,
ADD COLUMN     "resolvedByUserId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "dismissReason" TEXT;

-- CreateIndex
CREATE INDEX "UpSellRecommendation_customerId_idx" ON "UpSellRecommendation"("customerId");

-- CreateIndex
CREATE INDEX "UpSellRecommendation_status_idx" ON "UpSellRecommendation"("status");

-- "At most one OPEN recommendation per customer" as a real DB invariant, not
-- a check-then-act in the detection service
-- (ibms-brain/meta/lex/race-safe-invariants.md). A PARTIAL UNIQUE (WHERE
-- status = 'OPEN'), not a full one: unlike #8's CrossSellOpportunity (full
-- UNIQUE on (customerId, gapLine) — a line gap is binary and one-shot), an
-- up-sell gap is a continuous, growing quantity (asset value climbs over
-- years), so a customer who converts/dismisses one recommendation must be
-- able to get a fresh one later once their assets have grown further. Raw
-- SQL — Prisma can't express the WHERE predicate on @@unique (same pattern
-- as 20260827180000's InsuranceProgram_one_live_per_risk_profile). The
-- detection service keeps a descriptive pre-check for the common non-racing
-- path and maps the Prisma P2002 on this index to the same "skip" for the
-- concurrent case.
CREATE UNIQUE INDEX "UpSellRecommendation_one_open_per_customer"
  ON "UpSellRecommendation"("customerId")
  WHERE "status" = 'OPEN';
