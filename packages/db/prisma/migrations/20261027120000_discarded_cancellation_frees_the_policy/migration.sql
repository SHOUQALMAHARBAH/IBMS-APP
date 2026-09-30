-- A DISCARDED CANCELLATION MUST FREE THE POLICY.
--
-- `Endorsement_one_live_cancellation_per_policy` (migration 20260902170000) is the race backstop for "one
-- cancellation in flight per policy". Its predicate was `changeType = 'cancellation' AND status <>
-- 'CLIENT_NOTIFIED'`, and a discarded endorsement can never reach CLIENT_NOTIFIED — a discarded record is
-- terminal. So the moment the discard columns existed, withdrawing a wrongly raised cancellation would have
-- blocked every future cancellation of that policy, permanently, at the database level.
--
-- That is the exact trap this feature exists to remove, one level down: the only exit from the block would
-- have been to APPLY the cancellation nobody wanted. Found by asking which existing readers reason about a
-- pre-commitment status, rather than by hitting it — the application pre-check in
-- `EndorsementRepository.findLiveCancellation` carries the same clause, but the index is what refuses.
--
-- This index is in `db:divergence`'s measured blind spot (it does not see partial indexes), which is why the
-- assertion below lives here: if a later migration drops or rewrites this index, that gate stays green.
DROP INDEX IF EXISTS "Endorsement_one_live_cancellation_per_policy";

CREATE UNIQUE INDEX "Endorsement_one_live_cancellation_per_policy"
  ON "Endorsement" ("policyId")
  WHERE "changeType" = 'cancellation'
    AND "status" <> 'CLIENT_NOTIFIED'
    AND "discardedAt" IS NULL;

DO $$
DECLARE
  predicate text;
BEGIN
  SELECT pg_get_expr(i.indpred, i.indrelid)
    INTO predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'Endorsement_one_live_cancellation_per_policy';

  IF predicate IS NULL THEN
    RAISE EXCEPTION 'Endorsement_one_live_cancellation_per_policy is missing or is no longer PARTIAL — a full unique index here would refuse a second cancellation of any policy, ever.';
  END IF;

  IF predicate NOT LIKE '%discardedAt%' THEN
    RAISE EXCEPTION 'Endorsement_one_live_cancellation_per_policy does not exclude discarded rows (predicate: %). A cancellation withdrawn as raised in error would block every future cancellation of that policy permanently.', predicate;
  END IF;

  IF predicate NOT LIKE '%CLIENT_NOTIFIED%' OR predicate NOT LIKE '%cancellation%' THEN
    RAISE EXCEPTION 'Endorsement_one_live_cancellation_per_policy lost part of its original predicate (now: %). It must still be scoped to cancellations that have not reached CLIENT_NOTIFIED.', predicate;
  END IF;
END $$;
