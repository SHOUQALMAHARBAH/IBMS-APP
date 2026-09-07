-- Process 28 — Claim Settlement.
--
-- "Large claims AND any claim payment the broker processes require a second
-- approver" (ibms-brain/meta/context/claims-lifecycle.md; the second trigger
-- is a distinct fact about the settlement, not derivable from any existing
-- column). Persisted so the second-approver gate can be RE-DERIVED from live
-- data at the decision point (Settlement.approvedAmount + this flag), never
-- from Claim.isLargeClaim's notification-time snapshot.
--
-- The Settlement model, its four Decimal money columns and the
-- `Settlement_maker_checker_distinct` CHECK (secondApproverUserId <>
-- approvedByUserId, migration 20260826091424) all already exist.
ALTER TABLE "Settlement"
  ADD COLUMN IF NOT EXISTS "brokerProcessedPayment" BOOLEAN NOT NULL DEFAULT false;
