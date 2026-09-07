-- Part C backlog #14 (Quote Comparison, Domain B Process 14). The
-- `ComparisonMatrix` / `ComparisonMatrixRow` tables already exist (migration
-- 20260825124114) with `ComparisonMatrix.rfqId` UNIQUE — this item is their
-- first consumer. This migration only adds:
--   * a provenance column (`ComparisonMatrix.builtByUserId`) — a bare
--     scalar, no relation; the AuditLogEntry row is the authoritative trail
--     (same shape as Quotation.capturedByUserId, migration 20260901120000).
--   * the FK / filter indexes `ComparisonMatrixRow` lacked.
--   * `@@unique([comparisonMatrixId, quotationId])` — one row per quotation
--     per matrix. A rebuild replaces rows wholesale; this keeps two
--     interleaved rebuilds from doubling a row
--     (ibms-brain/meta/lex/race-safe-invariants.md). Prisma-expressible
--     (no partial predicate), so no raw SQL — same as CrossSellOpportunity's
--     @@unique([customerId, gapLine]).
--
-- Both tables are empty in every environment this has been applied to (Part
-- C #14 is their first consumer — no code has ever written to them), so ADD
-- COLUMN needs no backfill. Same safety argument as 20260901120000.

-- AlterTable
ALTER TABLE "ComparisonMatrix" ADD COLUMN     "builtByUserId" TEXT;

-- CreateIndex
CREATE INDEX "ComparisonMatrixRow_comparisonMatrixId_idx" ON "ComparisonMatrixRow"("comparisonMatrixId");

-- CreateIndex
CREATE INDEX "ComparisonMatrixRow_quotationId_idx" ON "ComparisonMatrixRow"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonMatrixRow_comparisonMatrixId_quotationId_key" ON "ComparisonMatrixRow"("comparisonMatrixId", "quotationId");
