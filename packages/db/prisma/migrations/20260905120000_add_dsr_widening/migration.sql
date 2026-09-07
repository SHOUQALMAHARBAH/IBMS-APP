-- Process 52/M04 — Data Subject Request (DSR) Management (backlog Part D,
-- bundled under Process #52 "Data Protection Compliance").
--
-- The `DataSubjectRequest` model, the `DsrType` / `DsrStatus` enums, the
-- `WORKFLOW_TRANSITIONS.DataSubjectRequest` map (already unit-tested — see
-- workflow-transitions.config.spec.ts), the SLA_REGISTRY's
-- `dsr_access_deletion` / `dsr_correction_objection` entries (each with the
-- DPO-then-General-Manager two-stage escalation), and the `dsr.log` /
-- `dsr.handle` / `dsr.close` permissions all already existed — NO seed
-- change. This migration only WIDENS the model so it is usable:
--   - processedByUserId / closedByUserId / rejectionReason — the mandatory
--     supervisor sign-off before closure (Part 5.2 /
--     maker-checker-segregation.md): processedByUserId is the MAKER
--     (whichever of fulfil/partially-fulfil/reject drove the terminal
--     outcome), closedByUserId is the CHECKER. Both dsr.handle and dsr.close
--     are DPO-only permissions, so this segregates between two distinct DPO
--     officers, not between roles — the same shape as Complaint's
--     resolvedByUserId/closureApprovedByUserId (20260903170000).
--   - @@index([customerId]) / @@index([insuredPersonId]) /
--     @@index([dpoHandlerUserId]) — the list filters
--     (GET /dsr?customerId=&insuredPersonId=&dpoHandlerUserId=).
--   - noOpenRetentionHoldConfirmedAt — a @code-reviewer MAJOR fix: the
--     DELETION-only "no open retention hold" staff attestation
--     (`confirmNoOpenRetentionHold` on the fulfil request) was being
--     validated in-memory and discarded, leaving no persisted or audited
--     trace of which DPO officer attested it before closing a Deletion
--     request as fully fulfilled.

ALTER TABLE "DataSubjectRequest"
  ADD COLUMN IF NOT EXISTS "processedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "closedByUserId"    TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason"   TEXT,
  ADD COLUMN IF NOT EXISTS "noOpenRetentionHoldConfirmedAt" TIMESTAMP(3);

-- Maker/checker segregation of duties (Part 5.2 /
-- ibms-brain/meta/lex/maker-checker-segregation.md) — the DB-layer backstop
-- for the mandatory DPO sign-off before a DSR is closed. Allows NULL on
-- either side ("not yet decided" is not a violation); rejects only an actual
-- match once both are set. Mirrors Complaint_closure_maker_checker_distinct
-- (20260903170000) and the original set added in
-- 20260826091424_add_maker_checker_check_constraints.
DO $$ BEGIN
  ALTER TABLE "DataSubjectRequest"
    ADD CONSTRAINT "DataSubjectRequest_closure_maker_checker_distinct" CHECK (
      "closedByUserId" IS NULL OR "processedByUserId" IS NULL
      OR "closedByUserId" <> "processedByUserId"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "DataSubjectRequest_customerId_idx"
  ON "DataSubjectRequest" ("customerId");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_insuredPersonId_idx"
  ON "DataSubjectRequest" ("insuredPersonId");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_dpoHandlerUserId_idx"
  ON "DataSubjectRequest" ("dpoHandlerUserId");
