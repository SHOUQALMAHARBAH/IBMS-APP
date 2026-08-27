-- Part C backlog #5 (Needs Assessment, Domain A Process 5). Converts
-- NeedsAssessment.status from a free-text String column to a proper enum
-- (the values transcribe the model's own pre-existing "Draft -> Reviewed ->
-- Approved" status comment, minus the not-yet-built "Linked to
-- Opportunity/RFQ" terminal step) so NeedsAssessment can plug into
-- WorkflowTransitionService (A.6) the same way LeadStatus/KycStatus did.
-- Also adds NeedsAssessment.createdByUserId: the model had reviewedByUserId
-- /approvedByUserId (checker side) but no maker-side column to pair them
-- with for maker/checker segregation (A.5) — same "add the missing maker
-- column" move made for DataProcessingAgreement/CommissionLedgerEntry in
-- 20260826091355.
--
-- NeedsAssessment is empty in every environment this migration has been
-- applied to (no Needs Assessment module existed before this backlog item),
-- so the DROP COLUMN/ADD COLUMN rewrite and the NOT NULL createdByUserId
-- add below are safe — there is no data to lose or backfill.

-- CreateEnum
CREATE TYPE "NeedsAssessmentStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "NeedsAssessment" DROP COLUMN "status",
ADD COLUMN     "status" "NeedsAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "createdByUserId" TEXT NOT NULL;

-- Maker/checker segregation of duties (Part 5.2;
-- ibms-brain/meta/lex/maker-checker-segregation.md) — the DB-layer backstop
-- to assertDifferentActors() in needs-assessment.service.ts. Each column
-- allows NULL (not yet decided is not a violation) and only rejects a
-- checker equal to the maker once set. Same shape as the
-- 20260826091424_add_maker_checker_check_constraints migration.
ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_reviewer_maker_checker_distinct" CHECK (
    "reviewedByUserId" IS NULL OR "reviewedByUserId" <> "createdByUserId"
  );

ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_approver_maker_checker_distinct" CHECK (
    "approvedByUserId" IS NULL OR "approvedByUserId" <> "createdByUserId"
  );

-- CreateIndex
CREATE INDEX "NeedsAssessment_riskProfileId_idx" ON "NeedsAssessment"("riskProfileId");

-- CreateIndex
CREATE INDEX "NeedsAssessment_status_idx" ON "NeedsAssessment"("status");

-- CreateIndex
CREATE INDEX "NeedsAssessment_createdByUserId_idx" ON "NeedsAssessment"("createdByUserId");

-- CreateIndex
CREATE INDEX "RiskProfile_customerId_idx" ON "RiskProfile"("customerId");
