-- Process 48 (backlog Part C #48, Domain F — opens Compliance & Risk beyond
-- KYC). TransactionMonitoringAlert (Part 7.2 core schema) has existed since
-- the initial migration with no application code ever writing to it — this
-- is its first consumer, so widening it here needs no backfill.
--
-- sourceEntityType/sourceEntityId identify the exact Receipt that triggered
-- an event-scoped alert (large_premium_payment / third_party_payment_source);
-- both stay NULL for the two customer-level aggregate patterns
-- (frequent_cancellations / frequent_refunds), which have no single
-- triggering row.

-- AlterTable
ALTER TABLE "TransactionMonitoringAlert"
  ADD COLUMN "sourceEntityType" TEXT,
  ADD COLUMN "sourceEntityId" TEXT;

-- CreateIndex
CREATE INDEX "TransactionMonitoringAlert_customerId_idx" ON "TransactionMonitoringAlert"("customerId");

-- CreateIndex
CREATE INDEX "TransactionMonitoringAlert_status_idx" ON "TransactionMonitoringAlert"("status");

-- CreateIndex
CREATE INDEX "TransactionMonitoringAlert_patternType_idx" ON "TransactionMonitoringAlert"("patternType");

-- RACE-SAFE INVARIANT (ibms-brain/meta/lex/race-safe-invariants.md): the
-- nightly sweep must never mint a second alert for a Receipt it already
-- flagged, and neither may two concurrent sweep runs. A plain UNIQUE index
-- suffices here (unlike the partial index below) because Postgres treats
-- every NULL sourceEntityId as distinct from every other NULL — so the two
-- aggregate patterns (frequent_cancellations / frequent_refunds), which
-- never set sourceEntityId, are entirely unaffected by this constraint.
CREATE UNIQUE INDEX "TransactionMonitoringAlert_patternType_sourceEntityId_key" ON "TransactionMonitoringAlert"("patternType", "sourceEntityId");

-- RACE-SAFE INVARIANT: "at most one OPEN aggregate alert per (customer,
-- pattern)" — the UpSellRecommendation (20260827220000) / ClaimFollowUpAlert
-- (20260902190000) shape: a partial UNIQUE, hand-authored because Prisma
-- cannot express the WHERE predicate on @@unique. Scoped directly to
-- patternType IN (the two aggregate patterns) — NOT to "sourceEntityId IS
-- NULL" (a `@code-reviewer` BLOCKER on the first pass: the manual-log DTO
-- never sets sourceEntityId either, so a "sourceEntityId IS NULL" predicate
-- would also catch two unrelated manual alerts of the same patternType for
-- the same customer, e.g. two independent 'other'-pattern notes — exactly
-- the case the manual endpoint exists for). This predicate governs ONLY
-- frequent_cancellations / frequent_refunds, however they were created
-- (sweep or manual); every other patternType is unconstrained here and
-- relies solely on the event-scoped unique index above (which is a no-op
-- for a manual create, since Postgres treats each NULL sourceEntityId as
-- distinct). Once an alert is closed it leaves the index, so a customer
-- whose pattern recurs later can get a fresh alert.
CREATE UNIQUE INDEX "TransactionMonitoringAlert_one_open_aggregate_per_customer"
  ON "TransactionMonitoringAlert"("customerId", "patternType")
  WHERE "status" = 'open' AND "patternType" IN ('frequent_cancellations', 'frequent_refunds');
