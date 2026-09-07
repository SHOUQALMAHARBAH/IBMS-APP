-- Backlog Part C #22 — Endorsement Management. The `Endorsement` /
-- `Cancellation` / `Refund` / `CommissionReversal` / `PolicySchedule` models
-- and the `Refund_maker_checker_distinct` CHECK (migration 20260826091424)
-- already existed. This adds:
--
--   1. Endorsement.targetCoverage (JSONB) — the post-amendment coverage
--      snapshot captured at request time and materialised into a NEW
--      PolicySchedule version at APPLY (the prior version is never
--      overwritten; the partial UNIQUE PolicySchedule_one_open_per_policy from
--      migration 20260902140000 backstops "one open schedule per policy").
--
--   2. Two provenance timestamps on the endorsement lifecycle
--      (submittedToInsurerAt, financialAdjustmentCalculatedAt) — the engine's
--      TRANSITION audit rows stay authoritative; these mirror the existing
--      insurerConfirmedAt / appliedAt / clientNotifiedAt for the read model.
--
--   3. An FK index on Endorsement.policyId for the per-policy list.

ALTER TABLE "Endorsement" ADD COLUMN "targetCoverage" JSONB;
ALTER TABLE "Endorsement" ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "Endorsement" ADD COLUMN "submittedToInsurerAt" TIMESTAMP(3);
ALTER TABLE "Endorsement" ADD COLUMN "financialAdjustmentCalculatedAt" TIMESTAMP(3);
-- NOTE: `effectiveFrom` was added in a follow-up ALTER during the same
-- development session (the column landed a few minutes after the first apply);
-- both statements are folded here for the historical record and the DB was
-- reconciled with `_prisma_migrations`. It carries `IF NOT EXISTS` so a
-- replay against an environment that recorded the interim state is a no-op;
-- `migrate status` is clean on a fresh DB and on the reconciled dev/test DBs.

CREATE INDEX "Endorsement_policyId_idx" ON "Endorsement"("policyId");
