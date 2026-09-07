-- Backlog Part C #22 follow-up — code-review MAJOR.
--
-- "At most one in-flight cancellation Endorsement per Policy" is a race-safe
-- invariant (ibms-brain/meta/lex/race-safe-invariants.md). A plain
-- `policy.status === 'ACTIVE'` read-check in `requestCancellation` is NOT
-- enough: the Policy stays ACTIVE until the first cancellation is APPLIED, so
-- a second cancellation Endorsement can be raised and driven independently to
-- APPLIED — minting a SECOND `Refund` + `CommissionReversal` for the same
-- policy (a broker overpayment exposure, policy-lifecycle.md).
--
-- A cancellation that reaches the terminal `CLIENT_NOTIFIED` status drops out
-- of the index, so a later cancellation of a reinstated policy is still
-- possible. Prisma cannot express a partial UNIQUE with a predicate on two
-- columns (one of them the mutable `status`), so this is raw SQL with a `///`
-- note on `model Endorsement` (same pattern as
-- `PolicySchedule_one_open_per_policy` from migration 20260902140000).

CREATE UNIQUE INDEX "Endorsement_one_live_cancellation_per_policy"
  ON "Endorsement" ("policyId")
  WHERE "changeType" = 'cancellation' AND "status" <> 'CLIENT_NOTIFIED';
