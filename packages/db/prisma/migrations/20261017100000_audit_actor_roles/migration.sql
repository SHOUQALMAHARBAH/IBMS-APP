-- The audit log records the role the actor HELD, instead of resolving it from the present.
--
-- ============================================================================
-- WHY THIS ONE COULD NOT WAIT
-- ============================================================================
--
-- `AuditLogEntry` stored `userId` and nothing about that user's authority. To answer "what role
-- were they acting under", a reader had to look up that user's CURRENT role assignments — so a
-- promotion, a revocation, a role retirement or a rename silently rewrote what every historical
-- entry appears to say about that person. On an append-only table, with no trace.
--
-- Every other gap the audit found (source IP, device, evidence ids, SLA context, hash-chaining)
-- can be added later and will simply be empty for older rows. This one cannot: **a role held in
-- the past that was never written down is not recoverable from anything.** Each day it stayed
-- unstored was a day of history that can never be reconstructed, which is why it landed first
-- and alone.
--
-- ============================================================================
-- WHY BOTH IDS AND NAMES
-- ============================================================================
--
-- `actorRoleIds` identifies WHICH `Role` rows — it survives a rename and is what a reviewer
-- follows to the grant history. `actorRoleNames` captures the LABEL as it stood, because an
-- office can rename its own roles from `/settings/roles`, and a rename must not retroactively
-- relabel history: "approved by Claims Triage Desk" cannot silently become "approved by Legacy
-- Desk". Neither column substitutes for the other.
--
-- ============================================================================
-- EMPTY IS AN ANSWER, NOT A HOLE
-- ============================================================================
--
-- Existing rows get `{}`. That is deliberate and honest — it says "not recorded", where any
-- backfill would have to invent a role from present-day assignments, which is precisely the
-- defect being removed. The same empty value is correct for writes with no authenticated actor
-- in context: a scheduled sweep, a seed, or the session-rejection paths that audit their own
-- refusal before the actor's roles are known.
--
-- Adding a `text[]` column with a constant default is a metadata-only change in Postgres 11+, so
-- this does not rewrite the table — which matters here: `AuditLogEntry` is the largest table in
-- the database (measured 5,934,528 rows / 3,529 MB on db-test).

ALTER TABLE "AuditLogEntry"
  ADD COLUMN "actorRoleIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "actorRoleNames" TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Verify, on the database being deployed to.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  n_ids   int;
  n_names int;
BEGIN
  SELECT count(*) INTO n_ids FROM information_schema.columns
   WHERE table_name = 'AuditLogEntry' AND column_name = 'actorRoleIds';
  SELECT count(*) INTO n_names FROM information_schema.columns
   WHERE table_name = 'AuditLogEntry' AND column_name = 'actorRoleNames';

  IF n_ids <> 1 OR n_names <> 1 THEN
    RAISE EXCEPTION 'The actor-role columns were not both created. Storing only one is worse than storing neither: ids without names lose the label a rename would have changed, and names without ids lose the thread back to the grant history.';
  END IF;

  -- The immutability triggers must still be the only thing standing between this table and an
  -- edit. Asserted here because this migration is the first to ALTER the table since they were
  -- created, and `ALTER TABLE` is exactly the operation someone would reach for to drop one.
  IF (
    SELECT count(*) FROM pg_trigger
     WHERE tgrelid = '"AuditLogEntry"'::regclass AND NOT tgisinternal
  ) <> 2 THEN
    RAISE EXCEPTION 'AuditLogEntry no longer carries exactly its two immutability triggers (no_update, no_delete). Adding a column must not cost the append-only guarantee.';
  END IF;
END
$assert$;
