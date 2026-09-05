-- Part C backlog #11 (RFQ / Market Submission, Domain B Process 11) — the
-- first Domain B module. No enum conversion this time: OpportunityStatus and
-- RfqInsurerStatus are already proper Prisma enums, so Opportunity and
-- RFQInsurer already plug into WorkflowTransitionService (A.6) directly. This
-- migration only adds:
--   * provenance columns (Opportunity.createdByUserId, RFQ.issuedByUserId) —
--     bare scalars, no relation; the AuditLogEntry CREATE row is the
--     authoritative trail (same shape as InsuranceProgram.assembledByUserId,
--     migration 20260827180000).
--   * the parent-FK / filter indexes the schema lacked.
--   * two race-safe invariants (ibms-brain/meta/lex/race-safe-invariants.md).
--
-- Opportunity, RFQ and RFQInsurer are empty in every environment this has
-- been applied to (Part C #11 is their first consumer — no code has ever
-- written to them), so the ADD COLUMN needs no backfill. Same safety
-- argument as 20260827200000 / 20260827220000.

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN     "issuedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Opportunity_insuranceProgramId_idx" ON "Opportunity"("insuranceProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_opportunityId_insuranceLine_key" ON "RFQ"("opportunityId", "insuranceLine");

-- CreateIndex
CREATE INDEX "RFQInsurer_insurerId_idx" ON "RFQInsurer"("insurerId");

-- CreateIndex
CREATE INDEX "RFQInsurer_status_idx" ON "RFQInsurer"("status");

-- "At most one live Opportunity per InsuranceProgram" as a real DB
-- invariant, not a findMany().find() check-then-act in OpportunityService
-- (ibms-brain/meta/lex/race-safe-invariants.md). A PARTIAL UNIQUE (WHERE
-- status <> 'CLOSED_LOST'), not a full one: a lost placement leaves the
-- Opportunity CLOSED_LOST, and the same finalized Insurance Program can then
-- be taken back to market as a fresh Opportunity (re-marketing per
-- ibms-brain/meta/context/policy-lifecycle.md). Raw SQL — Prisma can't
-- express the WHERE predicate on @@unique (same pattern as 20260827180000's
-- InsuranceProgram_one_live_per_risk_profile and 20260827220000's
-- UpSellRecommendation_one_open_per_customer). OpportunityService keeps a
-- descriptive pre-check for the common non-racing path and maps the Prisma
-- P2002 on this index to the same 409 for the concurrent case.
CREATE UNIQUE INDEX "Opportunity_one_live_per_insurance_program"
  ON "Opportunity"("insuranceProgramId")
  WHERE "status" <> 'CLOSED_LOST' AND "insuranceProgramId" IS NOT NULL;
