-- Part C backlog #13 (Quotation Management, Domain B Process 13). The
-- `Quotation` table already exists (migration 20260825124114) with the
-- version-chain columns (`versionNumber`, `previousVersionId` UNIQUE,
-- `isCurrentVersion`) — this item is its first consumer. This migration
-- only adds:
--   * a provenance column (`Quotation.capturedByUserId`) — a bare scalar,
--     no relation; the AuditLogEntry CREATE row is the authoritative trail
--     (same shape as RFQ.issuedByUserId, migration 20260828120000).
--   * the `insurerId` filter index the schema lacked (the FK alone is not
--     indexed by Postgres).
--   * the race-safe "one current version per chain" invariant
--     (ibms-brain/meta/lex/race-safe-invariants.md).
--
-- `Quotation` is empty in every environment this has been applied to (Part C
-- #13 is its first consumer — no code has ever written to it), so ADD COLUMN
-- needs no backfill. Same safety argument as 20260828120000.

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "capturedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Quotation_insurerId_idx" ON "Quotation"("insurerId");

-- "At most one current version per version chain" as a real DB invariant,
-- not a findFirst()-then-create() check-then-act in QuotationService
-- (ibms-brain/meta/lex/race-safe-invariants.md — the lex file names "one
-- current Quotation version" as an example of exactly this class). A
-- version chain is every row sharing one (rfqId, insurerId) — one insurer's
-- successive quotes on one RFQ line. PARTIAL (WHERE "isCurrentVersion" =
-- true) so the superseded history rows are unconstrained. Raw SQL — Prisma
-- can't express the WHERE predicate on @@unique (same pattern as
-- 20260827180000's InsuranceProgram_one_live_per_risk_profile,
-- 20260827220000's UpSellRecommendation_one_open_per_customer, and
-- 20260828120000's Opportunity_one_live_per_insurance_program).
--
-- QuotationService.capture() maps the Prisma P2002 on this index to a 409
-- ("this insurer already has a quotation on this RFQ — revise it instead"),
-- and revise() leans on it plus the existing UNIQUE on `previousVersionId`
-- (only one successor per node) as the concurrent-revision backstops.
CREATE UNIQUE INDEX "Quotation_one_current_version_per_rfq_insurer"
  ON "Quotation"("rfqId", "insurerId")
  WHERE "isCurrentVersion" = true;
