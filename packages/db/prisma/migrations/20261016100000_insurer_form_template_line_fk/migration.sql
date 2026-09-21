-- `InsurerFormTemplate.insuranceLine` stops being a string somebody types.
--
-- ============================================================================
-- WHY THE GLOBAL CATALOGUE AND NOT THE OFFICE ONE
-- ============================================================================
--
-- `InsurerOfferedLine` carries TWO nullable line FKs — one to `InsuranceLine`, one to
-- `OfficeInsuranceLine` — because an office may offer a line it invented itself. This model is
-- the opposite shape, and the reason is tenancy rather than taste:
--
-- `InsurerFormTemplate` has NO `organizationId`. It hangs off `InsurerMaster`, so one mapping is
-- read by EVERY office — that is the whole point of the feature, that an office which has never
-- dealt with an insurer still gets the mapping someone else made. An `OfficeInsuranceLine`
-- belongs to exactly one office. A global row pointing at one would put office A's private
-- vocabulary on a row office B reads, which is a cross-office disclosure of exactly the kind the
-- insurer directory was built to prevent. And the structural guard used elsewhere is unavailable
-- here: the composite FK `(childId, organizationId) -> Parent(id, organizationId)` needs the
-- child to carry an `organizationId` to agree with, and a global child has none.
--
-- So the restriction is enforced by the FK pointing at ONE table, plus a 422 in the service that
-- explains it when someone passes an office line's id.
--
-- ============================================================================
-- NO BACKFILL, AND THE MIGRATION REFUSES RATHER THAN INVENTING ONE
-- ============================================================================
--
-- Both databases hold ZERO template rows (dev 0, db-test 0, measured before writing this), so
-- there is nothing to map. But the pre-check below refuses on any database that DOES hold rows
-- instead of guessing, because free text cannot be mapped to the managed vocabulary
-- automatically: "Motor", "motor comprehensive" and "Vehicle" are all plausible strings for one
-- line and picking for the operator would silently attach a form to the wrong line, which is a
-- form every office on the platform then submits against.
--
-- This is the same shape as the rule that now governs `canonical_name_key` migrations: check
-- BEFORE changing, and fail with a message naming what blocks it, so the operator gets a
-- sentence rather than a constraint violation halfway through.

DO $precheck$
DECLARE
  n       bigint;
  distinct_lines text;
BEGIN
  SELECT count(*) INTO n FROM "InsurerFormTemplate";
  IF n > 0 THEN
    SELECT string_agg(DISTINCT quote_literal("insuranceLine"), ', ') INTO distinct_lines
    FROM "InsurerFormTemplate";
    RAISE EXCEPTION E'% InsurerFormTemplate row(s) exist, carrying these free-text lines:\n  %\n\nThere is no automatic mapping from free text to the managed vocabulary — "Motor", "motor comprehensive" and "Vehicle" are all plausible strings for one line, and choosing for you would attach a form to the wrong line that every office then submits against. Map each row to an InsuranceLine.id by hand, then re-run. Nothing has been changed.', n, distinct_lines;
  END IF;
END
$precheck$;

-- ---------------------------------------------------------------------------
-- The column swap. Safe as a DROP/ADD only because the pre-check proved 0 rows.
-- ---------------------------------------------------------------------------
-- The unique index goes first: it names the column being dropped.
DROP INDEX "InsurerFormTemplate_insurerMasterId_insuranceLine_version_key";

ALTER TABLE "InsurerFormTemplate" DROP COLUMN "insuranceLine";
ALTER TABLE "InsurerFormTemplate" ADD COLUMN "insuranceLineId" TEXT NOT NULL;

-- `ON DELETE RESTRICT` is DECLARED, not defaulted. A required Prisma relation defaults to
-- Restrict already, so this matches — and it is spelled out because § 1.30 found the opposite
-- case: an FK the database enforced as RESTRICT while the schema described `SetNull`, which the
-- next generated migration would have quietly applied.
ALTER TABLE "InsurerFormTemplate"
  ADD CONSTRAINT "InsurerFormTemplate_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- One version of a given line's form per insurer. A re-map is a NEW version, never an edit of
-- the one other offices are already submitting against.
CREATE UNIQUE INDEX "InsurerFormTemplate_insurerMasterId_insuranceLineId_version_key"
  ON "InsurerFormTemplate" ("insurerMasterId", "insuranceLineId", "version");

-- ---------------------------------------------------------------------------
-- Verify what was built, on the database being deployed to.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  deltype "char";
BEGIN
  SELECT confdeltype INTO deltype FROM pg_constraint
  WHERE conname = 'InsurerFormTemplate_insuranceLineId_fkey';

  IF deltype IS NULL THEN
    RAISE EXCEPTION 'InsurerFormTemplate_insuranceLineId_fkey was not created — the line is still unconstrained free text as far as the database is concerned.';
  END IF;
  IF deltype <> 'r' THEN
    RAISE EXCEPTION 'InsurerFormTemplate_insuranceLineId_fkey has ON DELETE "%" rather than RESTRICT. Anything weaker lets a line be removed from under a form template that every office submits against.', deltype;
  END IF;

  -- The old column must be gone, not merely unused: a leftover would let a writer keep setting
  -- it and give two sources of truth for the same fact.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'InsurerFormTemplate' AND column_name = 'insuranceLine'
  ) THEN
    RAISE EXCEPTION 'The free-text "insuranceLine" column still exists alongside "insuranceLineId" — two sources of truth for one fact.';
  END IF;

  -- And the office table must NOT be reachable from here. Asserted because the whole tenancy
  -- argument in this file's header rests on it, and a future migration adding a second FK
  -- "for symmetry with InsurerOfferedLine" is exactly the plausible mistake.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class p ON p.oid = c.confrelid
    WHERE c.conrelid = '"InsurerFormTemplate"'::regclass
      AND p.relname = 'OfficeInsuranceLine'
  ) THEN
    RAISE EXCEPTION 'InsurerFormTemplate has a foreign key to OfficeInsuranceLine. This model is GLOBAL (no organizationId), so an office-private line reached through it is readable by every other office.';
  END IF;
END
$assert$;
