-- Part D §5.1 — Data Retention & Secure Disposal (M06, backlog Part D
-- Process #52). First real writer for RetentionScheduleItem/LegalHold/
-- DisposalBatch/CertificateOfDestruction — all four have existed since the
-- initial domain-model migration with zero prior application code.
--
-- RetentionScheduleItem.recordCategory gets a genuine UNIQUE constraint —
-- the model originally had none, letting a duplicate schedule row for the
-- same category slip in; "a documented retention-period table" (the
-- backlog's own phrase) means one row per category, not a free-running
-- log. Confirmed no existing duplicate rows in dev or test before adding
-- this (only the one seeded AuditLogEntry draft row exists in either).
--
-- LegalHold gains retentionScheduleItemId — an OPTIONAL FK making "exclude
-- records under an active Legal Hold from routine disposal" mechanically
-- checkable against a DisposalBatch's own category, rather than only a
-- free-text `scope` description a caller could never reliably match
-- against. `scope` stays as-is for holds not tied to a whole category
-- (e.g. one customer's file under litigation).

ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_recordCategory_key" UNIQUE ("recordCategory");

ALTER TABLE "LegalHold"
  ADD COLUMN IF NOT EXISTS "retentionScheduleItemId" TEXT;

DO $$ BEGIN
  ALTER TABLE "LegalHold"
    ADD CONSTRAINT "LegalHold_retentionScheduleItemId_fkey"
    FOREIGN KEY ("retentionScheduleItemId") REFERENCES "RetentionScheduleItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "LegalHold_retentionScheduleItemId_idx"
  ON "LegalHold" ("retentionScheduleItemId");
CREATE INDEX IF NOT EXISTS "LegalHold_releasedAt_idx"
  ON "LegalHold" ("releasedAt");
CREATE INDEX IF NOT EXISTS "DisposalBatch_retentionScheduleItemId_idx"
  ON "DisposalBatch" ("retentionScheduleItemId");
CREATE INDEX IF NOT EXISTS "DisposalBatch_status_idx"
  ON "DisposalBatch" ("status");
