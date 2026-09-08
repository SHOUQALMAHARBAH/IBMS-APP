-- Part F item #4 (remainder) — Jordanian national-ID-convention name
-- splitting (given name + father's name + grandfather's name + family
-- name, the four parts printed on a Jordanian national ID card). Adds 4
-- nullable columns to the 3 models with both a real CRUD surface AND an
-- existing `nationalIdEnc` field to verify against: Customer (individual
-- customers only — the corporate `legalName` is a company name, untouched),
-- Employee, UltimateBeneficialOwner. `InsuredPerson` (the 4th model with
-- `nationalIdEnc`) is deliberately excluded — it has zero CRUD anywhere in
-- this app yet.
--
-- The existing flat column (Customer.legalName / Employee.fullName /
-- UltimateBeneficialOwner.fullName) stays as a computed/denormalized
-- display string, auto-joined from these 4 parts on create
-- (apps/api/src/common/person-name.util.ts's composeFullName()) — every
-- existing consumer (Arabic sorting, <bdi> display, search, audit logs,
-- exports) keeps working unchanged against the same field name.
--
-- No backfill: historical rows keep only their flat name with all 4 new
-- parts NULL — inventing a split for text no one actually entered that way
-- would be fabricating data.

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "givenName" TEXT,
  ADD COLUMN IF NOT EXISTS "fatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "grandfatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "familyName" TEXT;

ALTER TABLE "Employee"
  ADD COLUMN IF NOT EXISTS "givenName" TEXT,
  ADD COLUMN IF NOT EXISTS "fatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "grandfatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "familyName" TEXT;

ALTER TABLE "UltimateBeneficialOwner"
  ADD COLUMN IF NOT EXISTS "givenName" TEXT,
  ADD COLUMN IF NOT EXISTS "fatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "grandfatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "familyName" TEXT;
