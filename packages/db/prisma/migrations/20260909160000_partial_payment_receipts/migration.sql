-- Partial payments, application half (IMPROVEMENTS.md §3.4).
--
-- Migration 20260909120000_allow_partial_payments dropped
-- "Receipt_invoiceId_key" so an invoice can carry several instalment
-- receipts, but shipped no application logic with it. That left the
-- collection cycle with NO race backstop at all: CollectionService's
-- `finishReceipt` P2002 branch (which resumed or 409'd a concurrent double
-- receipt) became unreachable, so two concurrent calls could each write a
-- Receipt AND an `in` ClientFundsLedgerEntry — double-counting client money.
-- This migration supplies the replacement invariant.
--
-- `reference` is the payment/bank reference for the instalment. It doubles as
-- the idempotency key: with several receipts legitimately allowed per
-- invoice, an identical re-POST can no longer be told apart from a genuine
-- second instalment by its figures alone. Same role
-- CommissionLedgerEntry.paymentReference already plays at settlement.

-- FIRST: actually drop the old one-receipt-per-invoice constraint.
--
-- Migration 20260909120000 tried to, with:
--     ALTER TABLE "Receipt" DROP CONSTRAINT IF EXISTS "Receipt_invoiceId_key";
-- That is a NO-OP here. Prisma materialises a scalar `@unique` as a unique
-- INDEX, not a table CONSTRAINT, and `DROP CONSTRAINT IF EXISTS` silently
-- does nothing when the name belongs to an index — so `Receipt_invoiceId_key`
-- survived on every already-migrated database (verified with `\d "Receipt"`
-- on db-test: the index was still listed).
--
-- The consequence was a schema/database DIVERGENCE rather than a live bug:
-- `schema.prisma` had already dropped the `@unique`, so a database created
-- FRESH from the schema had no protection, while every migrated database
-- still did. Application code written for either one would be wrong on the
-- other. Dropping the index is what makes the two agree.
DROP INDEX IF EXISTS "Receipt_invoiceId_key";

ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- Partial UNIQUE: at most one receipt per (invoice, reference) when a
-- reference was supplied. NULL references (a cash collection with no bank
-- reference) are unconstrained, exactly as the pre-existing partial UNIQUEs
-- on Invoice/Endorsement/ClaimFollowUpAlert treat their nullable columns.
CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_invoiceId_reference_key"
  ON "Receipt" ("invoiceId", "reference")
  WHERE "reference" IS NOT NULL;
