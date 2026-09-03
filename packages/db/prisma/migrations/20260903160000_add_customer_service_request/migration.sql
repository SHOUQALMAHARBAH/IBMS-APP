-- Process 41 — Customer Requests (backlog Part C #41, Domain E — Customer
-- Service). Opens Domain E.
--
-- The `ServiceRequest` model, its `slaTimerId @unique` link to the generic
-- `SlaTimer`, and the `service-request.manage`
-- `[SALES_RELATIONSHIP_OFFICER, BRANCH_DEPARTMENT_MANAGER]` permission all
-- already existed — NO seed change.
--
-- This migration only widens `ServiceRequest` so it is a usable request record:
--   - policyId          — the policy the request is about (a certificate /
--     copy / change is almost always for one policy). Nullable FK, ON DELETE
--     SET NULL (a hard-deleted policy must not cascade-delete the service
--     history).
--   - detail            — free text, what specifically is requested.
--   - raisedByUserId / assignedToUserId / fulfilledByUserId — the service-desk
--     ownership trail (bare scalars, no relation — the AuditLogEntry CREATE /
--     UPDATE rows are the authoritative trail, same pattern as
--     Policy.placedByUserId).
--   - outcomeNote       — what was done (fulfil) / why cancelled — mandatory at
--     closure, logged verbatim.
--   - @@index([customerId]) — "this customer's requests"
--   - @@index([status, createdAt]) — the "open queue" read (status filter +
--     newest-first order)
--   - @@index([assignedToUserId]) — the "my queue" read
--
-- `ServiceRequest.status` stays a PLAIN STRING (open | in_progress | fulfilled
-- | cancelled) — NOT a WorkflowTransition entity; the legal moves live in
-- service-request.config.ts's SERVICE_REQUEST_TRANSITIONS and every move is a
-- status-conditional updateMany (race-safe-invariants.md).

ALTER TABLE "ServiceRequest"
  ADD COLUMN IF NOT EXISTS "policyId"          TEXT,
  ADD COLUMN IF NOT EXISTS "detail"            TEXT,
  ADD COLUMN IF NOT EXISTS "raisedByUserId"    TEXT,
  ADD COLUMN IF NOT EXISTS "assignedToUserId"  TEXT,
  ADD COLUMN IF NOT EXISTS "fulfilledByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "outcomeNote"       TEXT;

DO $$ BEGIN
  ALTER TABLE "ServiceRequest"
    ADD CONSTRAINT "ServiceRequest_policyId_fkey"
    FOREIGN KEY ("policyId") REFERENCES "Policy"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ServiceRequest_customerId_idx"
  ON "ServiceRequest" ("customerId");
CREATE INDEX IF NOT EXISTS "ServiceRequest_status_createdAt_idx"
  ON "ServiceRequest" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ServiceRequest_assignedToUserId_idx"
  ON "ServiceRequest" ("assignedToUserId");
