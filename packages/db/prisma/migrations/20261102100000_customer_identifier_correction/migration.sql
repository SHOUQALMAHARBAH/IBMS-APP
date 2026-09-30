-- Correcting a SCREENING IDENTIFIER is a screening event, and the evidence is retained per change.
--
-- THE REGULATION, VERIFIED BY THE OWNER AGAINST THE PRIMARY SOURCE
-- ---------------------------------------------------------------
--   "Upon any updates to the Local Terrorist List or UN Consolidated List … Prior to onboarding new
--    customers … Upon KYC reviews or CHANGES TO A CUSTOMER'S INFORMATION … Before processing any
--    transaction."
--   "further search should be made with the other identifiers (full name, date of birth, nationality)."
--   "the entity must keep the verification mechanism and actions taken regarding the case in internal
--    records."
--   — https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
--
-- So this table is not bookkeeping. Retaining the verification mechanism and the actions taken IS the
-- obligation, and the prior screening result is part of it.
--
-- WHAT IT STORES, AND WHAT IT DELIBERATELY DOES NOT DUPLICATE
-- ----------------------------------------------------------
-- The owner's list is: before and after values, who, when, why, BOTH screening results, the list version
-- used, the screening time, who reviewed a potential match, and the final decision.
--
-- Four of those already exist as rows and are POINTED AT rather than copied: `ScreeningResult` carries
-- `datasetVersion` (the list version) and `screenedAt` (the screening time), and `ScreeningMatch` carries
-- `status`, `closedByUserId` and `closedAt` (who reviewed a potential match, and the decision). Copying
-- them here would create a second place the same fact lives, which is how two records of one event come to
-- disagree. The FKs to the prior and new results are what make "NEVER DELETE THE PRIOR RESULT" structural:
-- ON DELETE RESTRICT means the prior result cannot be removed while a correction references it.
--
-- BEFORE AND AFTER ARE ENCRYPTED
-- -----------------------------
-- A corrected national ID is Highly Confidential, and `Customer.nationalIdEnc` exists precisely so that
-- value is not at rest in the clear. Storing the before/after here in plaintext would put it in a second
-- table unencrypted and defeat the column it came from. So both are `*Enc` and go through the same
-- `EncryptionService` as everything else — the regulation's retention requirement and
-- `sensitive-data-handling.md` are satisfied together rather than traded off.
--
-- WHAT IS NOT HERE, AND WHY
-- ------------------------
-- The owner's identifier list includes PLACE OF BIRTH and PASSPORT. **Neither is a column on `Customer`**
-- — measured, not assumed. Adding them is a data-model decision about what identity evidence this product
-- holds, with its own encryption, KYC-capture and screening-discriminator consequences, so they are absent
-- here rather than invented. IMPROVEMENTS § 3.14 records it.

CREATE TABLE "CustomerIdentifierCorrection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "customerId" TEXT NOT NULL,
  -- Which identifier. A plain string rather than an enum: the set is defined by the DTO that accepts them
  -- and an enum here would be a second list to keep in step, but the CHECK below pins the vocabulary so a
  -- typo cannot become a silent new category.
  "field" TEXT NOT NULL,
  "beforeValueEnc" TEXT,
  "afterValueEnc" TEXT,
  "reason" TEXT NOT NULL,
  "correctedByUserId" TEXT NOT NULL,
  "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The screening either side of the change. The prior one is the evidence the regulation requires kept;
  -- the new one is what replaced it. Both nullable, because a correction made before any screening has run
  -- has no prior result to point at and the record must still exist.
  "priorScreeningResultId" TEXT,
  "newScreeningResultId" TEXT,
  -- The KYC file's status immediately before the correction, so the record says what was undone.
  "kycStatusBefore" TEXT,
  "kycRecordId" TEXT,
  -- The one part of the owner's brief that is NOT adopted as automatic.
  --
  -- A documented clerical correction MAY leave the prior identity verification standing — but only when it
  -- is documented as clerical WITH evidence, the decision to retain is recorded against the person who made
  -- it, and it appears in the compliance report. Otherwise re-verification is the default. The general rule
  -- the owner gave: what ADDS a control may be adopted on a reasonable source; what REMOVES one requires
  -- explicit text, and the AMLU page does not say this.
  --
  -- So these columns EXIST and nothing writes them yet. Re-verification is unconditional today.
  "clericalRetentionEvidence" TEXT,
  "clericalRetentionDecidedByUserId" TEXT,
  "clericalRetentionDecidedAt" TIMESTAMP(3),

  CONSTRAINT "CustomerIdentifierCorrection_pkey" PRIMARY KEY ("id")
);

-- The vocabulary, pinned. `placeOfBirth` and `passportNumber` are absent because the columns are.
ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_field_known"
  CHECK ("field" IN (
    'legalName', 'givenName', 'fatherName', 'grandfatherName', 'familyName',
    'dateOfBirth', 'nationality', 'nationalId', 'registrationNumber'
  ));

-- A retention decision is all three facts or none of them. A recorded decision with no evidence, or with
-- nobody named, is the shape the owner refused: it would let "documented as clerical" mean "somebody ticked
-- a box".
ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_clerical_retention_complete"
  CHECK (
    ("clericalRetentionEvidence" IS NULL
      AND "clericalRetentionDecidedByUserId" IS NULL
      AND "clericalRetentionDecidedAt" IS NULL)
    OR ("clericalRetentionEvidence" IS NOT NULL
      AND "clericalRetentionDecidedByUserId" IS NOT NULL
      AND "clericalRetentionDecidedAt" IS NOT NULL)
  );

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on both result FKs: the prior screening result is the evidence, and a delete that silently
-- nulled it would remove exactly what the regulation requires retained.
ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_priorScreeningResultId_fkey"
  FOREIGN KEY ("priorScreeningResultId") REFERENCES "ScreeningResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_newScreeningResultId_fkey"
  FOREIGN KEY ("newScreeningResultId") REFERENCES "ScreeningResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_kycRecordId_fkey"
  FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "CustomerIdentifierCorrection_organizationId_idx" ON "CustomerIdentifierCorrection"("organizationId");
CREATE INDEX "CustomerIdentifierCorrection_customerId_idx" ON "CustomerIdentifierCorrection"("customerId");
CREATE INDEX "CustomerIdentifierCorrection_correctedAt_idx" ON "CustomerIdentifierCorrection"("correctedAt");

-- Row-level security, the same shape every tenant-scoped table carries. Legal under Layer 1 because the
-- table CARRIES `organizationId` — `tenantScopeExtension` sets `app.current_org_id` only for models that
-- do, and a policy on any other table matches nothing forever (see `docs/multi-tenancy-rls.md`).
ALTER TABLE "CustomerIdentifierCorrection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerIdentifierCorrection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CustomerIdentifierCorrection_tenant_isolation" ON "CustomerIdentifierCorrection"
  USING ("organizationId" = current_setting('app.current_org_id', true));

DO $$
DECLARE
  n integer;
BEGIN
  -- The two CHECKs and the two evidence FKs are the whole point of the table; a migration that created it
  -- without them would look identical from the application.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"CustomerIdentifierCorrection"'::regclass
     AND conname IN (
       'CustomerIdentifierCorrection_field_known',
       'CustomerIdentifierCorrection_clerical_retention_complete',
       'CustomerIdentifierCorrection_priorScreeningResultId_fkey',
       'CustomerIdentifierCorrection_newScreeningResultId_fkey'
     );
  IF n <> 4 THEN
    RAISE EXCEPTION
      'CustomerIdentifierCorrection: expected the 2 CHECKs and the 2 screening-result FKs, found % of 4. The prior result is the evidence the AMLU requires retained; without the FK a delete removes it silently.', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'CustomerIdentifierCorrection';
  IF n < 1 THEN
    RAISE EXCEPTION 'CustomerIdentifierCorrection: row-level security policy missing — a correction record is per-office data.';
  END IF;
END $$;
