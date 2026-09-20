-- Insurer management — COMPANY-level contact details.
--
-- Four columns describing the company itself: its switchboard, its general mailbox,
-- its website and the address formal paperwork goes to. They are kept deliberately
-- separate from the `rfqContact*` / `claimsContact*` / `underwriterContact` columns
-- already on this table, which name the people who answer THIS office and never
-- leave it. The directory to come shows the first group and not the second, so which
-- group a field belongs to is a disclosure decision rather than a naming one.
--
-- All four are NULLABLE, and phone/email are nevertheless required at registration.
-- Every insurer registered before this migration has neither; a NOT NULL would need
-- a backfill, and there is no honest value to backfill a company phone number with.
-- The DTO enforces the requirement, which scopes it to new registrations — the same
-- shape as any field that becomes mandatory after rows already exist.
ALTER TABLE "Insurer"
  ADD COLUMN "companyPhone" TEXT,
  ADD COLUMN "companyEmail" TEXT,
  ADD COLUMN "companyWebsite" TEXT,
  ADD COLUMN "companyCorrespondenceAddress" TEXT;
