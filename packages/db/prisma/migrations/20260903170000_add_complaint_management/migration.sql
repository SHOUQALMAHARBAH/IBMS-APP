-- Process 42 — Complaints Management (backlog Part C #42, Domain E — Customer
-- Service).
--
-- The `Complaint` / `ComplaintAction` / `EscalationRecord` models, the
-- `ComplaintStatus` enum, `Complaint.slaTimerId @unique` (-> the generic
-- `SlaTimer`), the `WORKFLOW_TRANSITIONS.Complaint` map, and the
-- `complaint.log` / `complaint.close` / `complaint.escalate` permissions all
-- already existed -- NO seed change.
--
-- This migration only widens the three tables so they are usable:
--   Complaint:
--     - resolvedByUserId / resolvedAt -- who moved the complaint to RESOLVED
--       and when. resolvedByUserId is the MAKER for the mandatory supervisor
--       sign-off: it MUST differ from closureApprovedByUserId (the CHECK
--       below + assertDifferentActors -- Part 5.2 / maker-checker-segregation.md).
--     - @@index([status, createdAt]) -- the "open queue" read (replaces the
--       bare @@index([status])).
--     - @@index([claimId]) -- "complaints on this disputed claim".
--     - @@index([responsibleEmployeeUserId]) -- the "my queue" read.
--   ComplaintAction / EscalationRecord:
--     - escalatedByUserId on EscalationRecord -- who escalated.
--     - @@index([complaintId]) on both -- "this complaint's actions / escalations".

ALTER TABLE "Complaint"
  ADD COLUMN IF NOT EXISTS "resolvedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "resolvedAt"       TIMESTAMP(3);

ALTER TABLE "EscalationRecord"
  ADD COLUMN IF NOT EXISTS "escalatedByUserId" TEXT;

-- Maker/checker segregation of duties (Part 5.2 /
-- ibms-brain/meta/lex/maker-checker-segregation.md) -- the DB-layer backstop
-- for the mandatory supervisor sign-off before a complaint is closed. Allows
-- NULL on either side ("not yet decided" is not a violation); rejects only an
-- actual match once both are set. Mirrors the constraints added in
-- 20260826091424_add_maker_checker_check_constraints.
DO $$ BEGIN
  ALTER TABLE "Complaint"
    ADD CONSTRAINT "Complaint_closure_maker_checker_distinct" CHECK (
      "closureApprovedByUserId" IS NULL OR "resolvedByUserId" IS NULL
      OR "closureApprovedByUserId" <> "resolvedByUserId"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "Complaint_status_idx";
CREATE INDEX IF NOT EXISTS "Complaint_status_createdAt_idx"
  ON "Complaint" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Complaint_claimId_idx"
  ON "Complaint" ("claimId");
CREATE INDEX IF NOT EXISTS "Complaint_responsibleEmployeeUserId_idx"
  ON "Complaint" ("responsibleEmployeeUserId");
CREATE INDEX IF NOT EXISTS "ComplaintAction_complaintId_idx"
  ON "ComplaintAction" ("complaintId");
CREATE INDEX IF NOT EXISTS "EscalationRecord_complaintId_idx"
  ON "EscalationRecord" ("complaintId");
