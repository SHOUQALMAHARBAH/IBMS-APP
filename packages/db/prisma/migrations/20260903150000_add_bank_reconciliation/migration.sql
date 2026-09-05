-- Process 39 — Bank Reconciliation (backlog Part C #39, Domain D).
--
-- The `ReconciliationException` model, its three `Decimal(18,3)` money columns,
-- the `InvoiceStatus` `EXCEPTION_RAISED` / `EXCEPTION_RESOLVED` values, the
-- `WORKFLOW_TRANSITIONS.Invoice` exception branch, and the
-- `reconciliation-exception.investigate` `[FINANCE]` / `.resolve`
-- `[FINANCE, MANAGER]` perms all already existed — no seed change.
--
-- 1. AT MOST ONE non-resolved ReconciliationException per invoice. The
--    variance-detection job re-run for the same invoice must not mint a second
--    open exception; a read-then-create cannot hold this under a concurrent
--    POST /reconciliation-exceptions/detect
--    (ibms-brain/meta/lex/race-safe-invariants.md). Prisma cannot express a
--    predicate UNIQUE, so it lives here in raw SQL. `invoiceId IS NULL`
--    exceptions (not tied to an invoice) are unconstrained.
--
-- 2. raisedByUserId / resolvedByUserId / resolutionNote — the audit trail for
--    who raised the exception, who closed it, and the mandatory written
--    justification (the "investigation and closure path" is meaningless
--    without the explanation, and it must be a first-class field, not free
--    text buried in a log).

ALTER TABLE "ReconciliationException"
  ADD COLUMN IF NOT EXISTS "raisedByUserId"    TEXT,
  ADD COLUMN IF NOT EXISTS "resolvedByUserId"  TEXT,
  ADD COLUMN IF NOT EXISTS "resolutionNote"    TEXT;

CREATE INDEX IF NOT EXISTS "ReconciliationException_invoiceId_idx"
  ON "ReconciliationException" ("invoiceId");
CREATE INDEX IF NOT EXISTS "ReconciliationException_status_idx"
  ON "ReconciliationException" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationException_one_open_per_invoice"
  ON "ReconciliationException" ("invoiceId")
  WHERE "status" <> 'resolved' AND "invoiceId" IS NOT NULL;
