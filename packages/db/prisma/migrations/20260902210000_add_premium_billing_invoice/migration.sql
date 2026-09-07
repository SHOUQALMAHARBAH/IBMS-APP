-- Process 31 — Premium Billing (backlog Part C #31, Domain D).
--
-- The Invoice model and its five Decimal money columns (premiumAmount,
-- taxAmount, feesAmount, commissionDeducted, totalAmount), the InvoiceStatus
-- enum (@default(INVOICED)), and the WORKFLOW_TRANSITIONS.Invoice map all
-- already exist. #31 only CREATES the invoice at the schema default status —
-- the INVOICED -> COLLECTED cycle is Process 32.
--
-- 1. `invoiceType` distinguishes the new-business premium invoice from later
--    endorsement / renewal premium invoices raised against the same policy.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "invoiceType" TEXT NOT NULL DEFAULT 'new_business_premium';

-- 2. At most one new-business premium invoice per policy — a double-submit
--    must never bill the client's premium twice
--    (ibms-brain/meta/lex/race-safe-invariants.md: a "only once" invariant is
--    a DB constraint, not a findMany().find() check-then-act). Endorsement /
--    renewal premium invoices carry a different `invoiceType` and are not
--    constrained here. `policyId` is nullable; a NULL-policy invoice (not
--    reachable from #31, whose DTO requires policyId) is left unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_one_new_business_premium_per_policy"
  ON "Invoice" ("policyId")
  WHERE "invoiceType" = 'new_business_premium' AND "policyId" IS NOT NULL;

-- 3. Match the schema's new @@index([policyId]) (invoice reads are policy-scoped).
CREATE INDEX IF NOT EXISTS "Invoice_policyId_idx" ON "Invoice" ("policyId");
