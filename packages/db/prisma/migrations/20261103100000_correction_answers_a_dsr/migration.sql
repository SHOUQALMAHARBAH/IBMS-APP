-- A correction request may not close before the change is recorded.
--
-- THE OWNER'S REQUIREMENT 4, AND WHY IT IS THE PART NOT TO DEFER
-- -------------------------------------------------------------
-- `DsrType.CORRECTION` is a statutory right with a ten-working-day clock and a two-person closure, and it
-- is closed by a staff member's ATTESTATION. Nothing verifies the data changed. A closed request with
-- nothing behind it is worse than an open one, because the open one is visible and the falsely closed one
-- is not — and the falsely closed one is the record a regulator reads.
--
-- The DELETION type already has exactly this shape: `DsrService.fulfil` runs a LIVE check for an active
-- Legal Hold and refuses full fulfilment, rather than trusting an attestation. This gives CORRECTION the
-- same treatment, and the link below is what makes the check possible at all.
--
-- ONE CORRECTION TABLE FOR EVERY CORRECTED FIELD
-- ---------------------------------------------
-- The table shipped covering the nine screening IDENTIFIERS. The contact fields — phone, email, registered
-- address — were recorded only in an audit row, which is not queryable as "was this request answered".
-- Widening the vocabulary rather than adding a second table keeps the DSR gate ONE query, and the
-- screening columns simply stay null for a field that triggers no screening. Two tables would mean the
-- gate had to ask twice and would pass if either question were forgotten.
--
-- `dsrId` IS NULLABLE, DELIBERATELY
-- --------------------------------
-- Most corrections answer nobody: an officer notices a wrong phone number and fixes it. Requiring a DSR
-- would make the common case impossible, and a placeholder value would make "answered a request" unusable
-- as a filter. Null means "not in answer to a request", which is the truth.

ALTER TABLE "CustomerIdentifierCorrection"
  ADD COLUMN IF NOT EXISTS "dsrId" TEXT;

ALTER TABLE "CustomerIdentifierCorrection"
  DROP CONSTRAINT IF EXISTS "CustomerIdentifierCorrection_dsrId_fkey";

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_dsrId_fkey"
  FOREIGN KEY ("dsrId") REFERENCES "DataSubjectRequest"("id")
  -- RESTRICT: this row is the evidence that a statutory request was answered. A delete that nulled the
  -- link would leave the correction orphaned and the request looking unanswered.
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "CustomerIdentifierCorrection_dsrId_idx"
  ON "CustomerIdentifierCorrection"("dsrId");

-- The vocabulary now covers every correctable field. The three contact fields carry no screening
-- consequence, so a row for one of them has both screening-result columns null.
ALTER TABLE "CustomerIdentifierCorrection"
  DROP CONSTRAINT IF EXISTS "CustomerIdentifierCorrection_field_known";

ALTER TABLE "CustomerIdentifierCorrection"
  ADD CONSTRAINT "CustomerIdentifierCorrection_field_known"
  CHECK ("field" IN (
    -- Screening identifiers (AMLU: a change to one of these is a screening event).
    'legalName', 'givenName', 'fatherName', 'grandfatherName', 'familyName',
    'dateOfBirth', 'nationality', 'nationalId', 'registrationNumber',
    -- Contact details. No screening consequence; recorded so a correction request can be shown to have
    -- been answered rather than merely attested to.
    'contactPhone', 'contactEmail', 'registeredAddress'
  ));

DO $$
DECLARE
  n integer;
  allows_contact boolean;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"CustomerIdentifierCorrection"'::regclass
     AND conname = 'CustomerIdentifierCorrection_dsrId_fkey'
     AND confdeltype = 'r';
  IF n <> 1 THEN
    RAISE EXCEPTION
      'CustomerIdentifierCorrection.dsrId must have an ON DELETE RESTRICT FK — this row is the evidence a statutory request was answered.';
  END IF;

  -- The widened vocabulary, read from the ENFORCED definition rather than probed with an INSERT.
  --
  -- The first version of this assertion inserted a `contactPhone` row and caught `check_violation`. It
  -- PASSED on db-test and FAILED on dev with "new row violates row-level security policy" — because
  -- whether the migration's own session can insert into an RLS-FORCED table depends on the connecting
  -- role, and `app.current_org_id` is not set in a migration. An assertion whose answer depends on which
  -- database it runs against is not an assertion; it is a coin toss that looks like a gate.
  --
  -- `pg_get_constraintdef` is what the database actually enforces, and it is environment-independent.
  SELECT pg_get_constraintdef(oid) LIKE '%contactPhone%' INTO allows_contact
  FROM pg_constraint
  WHERE conrelid = '"CustomerIdentifierCorrection"'::regclass
    AND conname = 'CustomerIdentifierCorrection_field_known';
  IF allows_contact IS NOT TRUE THEN
    RAISE EXCEPTION
      'CustomerIdentifierCorrection: the field vocabulary does not admit `contactPhone`. The DSR closure gate could not see a contact correction, and would then refuse every closure it should allow.';
  END IF;
END $$;
