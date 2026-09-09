-- Allow multiple receipts per invoice for partial payment support
--
-- This migration supports Process 32 (Collection) gap: partial payments
-- (Process 3.4 gap). Previously, Receipt.invoiceId was @unique, forcing
-- exactly one full-amount receipt per invoice. This removes that constraint
-- and adds an index for efficient querying by invoice + date.

-- Remove the unique constraint
-- NOTE: This needs to be done carefully because the Prisma schema still
-- declares it as @unique. After this migration, regenerate the Prisma
-- client and update the schema.

-- The constraint name depends on the database — Postgres uses the pattern:
-- "ModelName_fieldName_key" for unique constraints
ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_invoiceId_key";

-- Add an index for efficient querying of receipts by invoice
CREATE INDEX IF NOT EXISTS "Receipt_invoiceId_receivedAt_idx" ON "Receipt"("invoiceId", "receivedAt");
