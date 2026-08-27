-- Part C backlog #8 (Cross-Selling, Domain A Process 8). Converts
-- CrossSellOpportunity.status from a free-text String column ("open") to a
-- proper enum so CrossSellOpportunity can plug into
-- WorkflowTransitionService (A.6) the same way LeadStatus / KycStatus /
-- NeedsAssessmentStatus / InsuranceProgramStatus did (the 4th such
-- conversion). The values transcribe the model's own status comment:
--   OPEN      — the detection sweep flagged a gap between the customer's
--               in-force policy lines and the benchmark line list.
--   CONVERTED — a Sales Officer took the gap forward into an Opportunity/RFQ
--               (Process 11+, not built).
--   DISMISSED — the gap is not being pursued (with a reason).
--
-- Also adds provenance / resolution columns:
--   * detectedByUserId — the actor behind the detection run: the system
--     service account for the nightly cron, the Sales Officer for an
--     on-demand scan. Bare scalar, no relation — the AuditLogEntry is the
--     authoritative trail (same shape as InsuranceProgram.assembledByUserId).
--   * resolvedByUserId / resolvedAt — who converted/dismissed the
--     opportunity, and when.
--   * dismissReason — required by the API when dismissing (why the gap is
--     not being pursued); null for OPEN / CONVERTED.
--
-- CrossSellOpportunity is empty in every environment this migration has been
-- applied to (Part C #8 is its first consumer — no code has ever written to
-- it), so the DROP COLUMN / ADD COLUMN rewrite loses no data and needs no
-- backfill. Same shape and safety argument as
-- 20260827180000_add_insurance_program_status_enum.

-- CreateEnum
CREATE TYPE "CrossSellStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "CrossSellOpportunity" DROP COLUMN "status",
ADD COLUMN     "status" "CrossSellStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "detectedByUserId" TEXT,
ADD COLUMN     "resolvedByUserId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "dismissReason" TEXT;

-- CreateIndex
CREATE INDEX "CrossSellOpportunity_status_idx" ON "CrossSellOpportunity"("status");

-- "At most one CrossSellOpportunity per (customer, benchmark line)" (Part C
-- #8) as a real DB invariant, not a check-then-act in the detection service
-- (ibms-brain/meta/lex/race-safe-invariants.md). A full UNIQUE (not a
-- partial one on OPEN): once a gap is CONVERTED or DISMISSED it is never
-- re-flagged — re-opening is a manual action with no endpoint yet (same
-- "modeled ahead of a real trigger" shape as
-- InsuranceProgramStatus.SUPERSEDED). The nightly sweep and the on-demand
-- scan both insert via createMany(skipDuplicates), so a concurrent run is a
-- no-op rather than a duplicate or an error. Prisma CAN express this one
-- (@@unique([customerId, gapLine])) — no raw SQL needed, unlike
-- InsuranceProgram's partial index.
CREATE UNIQUE INDEX "CrossSellOpportunity_customerId_gapLine_key" ON "CrossSellOpportunity"("customerId", "gapLine");
