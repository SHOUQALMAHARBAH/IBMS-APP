-- Part C backlog #7 (Product Recommendation / Program Design, Domain A
-- Process 7). Converts InsuranceProgram.status from a free-text String
-- column ("draft") to a proper enum so InsuranceProgram can plug into
-- WorkflowTransitionService (A.6) the same way LeadStatus / KycStatus /
-- NeedsAssessmentStatus did. The values transcribe the model's own status
-- comment: DRAFT (assembled) -> FINALIZED (locked to feed an Opportunity/RFQ
-- at Process 11+, not built) with SUPERSEDED reserved for a re-assembled
-- replacement (no endpoint triggers it in this backlog item yet).
--
-- Also adds two provenance columns:
--   * needsAssessmentId  — the APPROVED NeedsAssessment whose
--     recommendedCoverageLines drove the assembly (bare scalar, no relation;
--     the AuditLogEntry is the authoritative trail).
--   * assembledByUserId  — the Placement/Technical Officer who assembled it.
-- Both nullable — a program row can predate this column set only in theory
-- (see below).
--
-- InsuranceProgram / InsuranceProgramLine are empty in every environment
-- this migration has been applied to (no code has ever written to them —
-- Part C #7 is their first consumer), so the DROP COLUMN / ADD COLUMN
-- rewrite below loses no data and needs no backfill. Same shape and same
-- safety argument as 20260827120000_add_needs_assessment_status_enum.

-- CreateEnum
CREATE TYPE "InsuranceProgramStatus" AS ENUM ('DRAFT', 'FINALIZED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "InsuranceProgram" DROP COLUMN "status",
ADD COLUMN     "status" "InsuranceProgramStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "needsAssessmentId" TEXT,
ADD COLUMN     "assembledByUserId" TEXT;

-- CreateIndex
CREATE INDEX "InsuranceProgram_riskProfileId_idx" ON "InsuranceProgram"("riskProfileId");

-- CreateIndex
CREATE INDEX "InsuranceProgramLine_insuranceProgramId_idx" ON "InsuranceProgramLine"("insuranceProgramId");

-- "One live InsuranceProgram per RiskProfile" (Part C #7) as a real DB
-- invariant, not a check-then-act in the service. A partial UNIQUE index —
-- Prisma cannot express the `WHERE` predicate on `@@unique`, so this is
-- raw-SQL only (same pattern as the CHECK constraints in
-- 20260826091424 and the AuditLogEntry trigger in 20260826083942).
-- InsuranceProgramService.assemble() keeps the pre-check for a clean 409
-- message on the common non-racing path and maps the Prisma P2002 on this
-- index to the same 409 for the concurrent case.
CREATE UNIQUE INDEX "InsuranceProgram_one_live_per_risk_profile"
  ON "InsuranceProgram"("riskProfileId")
  WHERE "status" <> 'SUPERSEDED';
