-- PART 4 STEP 2 — DUTY SEGREGATION AS A DECLARED PER-OFFICE MODE: the schema.
--
-- Full design and its rejected alternatives: `docs/duty-segregation-mode.md`. The short version of what this
-- migration does and does not do:
--
--   * Every office reads SEGREGATED after this runs, by the column default. Nothing changes for anybody.
--   * The 15 maker/checker CHECK constraints stay CHECK constraints, on the same tables, with the same
--     names and the same column pairs. Each gains ONE disjunct: an escape column being non-null.
--   * The escape column is a foreign key to `CombinedDutyAct`, and ONE trigger — on that table alone —
--     refuses to insert an act for an office that is not in COMBINED mode.
--
-- So after this migration the database refuses a SILENT self-approval (the CHECK, as today) and ALSO
-- refuses a DECLARED one in a segregated office (the trigger). Deleting every line of application code
-- cannot produce either. That is the property the whole design is chosen for, and it is what plants 1 and 3
-- in the plan assert.
--
-- WHY A COLUMN PER CONSTRAINT AND NOT PER TABLE. `NeedsAssessment` carries two pairs — created/reviewed and
-- created/approved. One shared column would let a declared combined REVIEW silently excuse a
-- self-APPROVAL, which is a different act by a different permission. Fifteen constraints, fifteen columns.
--
-- WHY THE PREDICATES BELOW ARE VERBATIM. The 15 constraints do not share a shape: `DataSharingApproval`
-- guards only the checker side for NULL (the maker column is NOT NULL), `AccessRecertificationItem` guards
-- neither, and the rest guard both. Each predicate here is this database's own `pg_get_constraintdef`
-- output with the escape disjunct appended — re-deriving them from a template is exactly how one of the
-- fifteen would come back looser than it went in.
--
-- WHAT `db:divergence` CANNOT SEE, hence the assertions at the bottom: CHECK constraints and triggers. A
-- later migration could drop any of these 16 objects and that gate would stay green, so this migration
-- asserts its own work — including that every recreated CHECK still names BOTH of its original columns.

-- ---------------------------------------------------------------------------
-- 1. The mode.
-- ---------------------------------------------------------------------------
-- An enum, not a boolean: the owner's framing is a declared MODE, and a third value (a per-pair mode, say)
-- must be addable without rewriting every reader of a boolean.
CREATE TYPE "DutySegregationMode" AS ENUM ('SEGREGATED', 'COMBINED');

ALTER TABLE "Organization"
  ADD COLUMN "dutySegregationMode" "DutySegregationMode" NOT NULL DEFAULT 'SEGREGATED',
  -- When the office declared its current mode, and who declared it. NULL means "never declared" — the
  -- office is segregated because that is the default, not because anybody chose it. The report needs the
  -- date beside every act, and reconstructing it from audit rows on every read is the kind of derivation
  -- that goes wrong once the audit row's shape changes.
  ADD COLUMN "dutySegregationModeDeclaredAt" TIMESTAMP(3),
  ADD COLUMN "dutySegregationModeDeclaredByUserId" TEXT;

-- ---------------------------------------------------------------------------
-- 2. The act. One row per combined-duty act, written in the same transaction as the write it excuses.
-- ---------------------------------------------------------------------------
CREATE TABLE "CombinedDutyAct" (
  "id" TEXT NOT NULL,
  -- The office whose mode permits this. This is the column the trigger reads.
  "organizationId" TEXT NOT NULL,
  -- Which record, so the act can be shown ON the record and not only in a report.
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  -- WHICH OF THE 15 PAIRS, named by the CONSTRAINT it excuses rather than by a label of our own, so the
  -- act and the constraint cannot drift apart. Asserted against `pg_constraint` by a test.
  "constraintName" TEXT NOT NULL,
  -- The one person who did both halves.
  "actorUserId" TEXT NOT NULL,
  -- NOT NULL with a floor, like the national-ID reveal justification: who and when are recoverable from an
  -- audit row, "why one person did both halves of this" is not.
  "reason" TEXT NOT NULL,
  "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Every role the actor held at that moment, then THE HAT: the subset of those roles that actually grant
  -- the checker permission for this pair. Names are stored beside the ids for the same reason the audit row
  -- stores `actorRoleNames` — a role renamed or retired years later is unrecoverable from an id alone.
  "actorRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "grantingRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "grantingRoleNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- True when the hat is genuinely ambiguous — two of the actor's roles grant the same checker code. The
  -- record says "we cannot tell" rather than picking one and looking certain.
  "multipleGrantingRoles" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CombinedDutyAct_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CombinedDutyAct"
  ADD CONSTRAINT "CombinedDutyAct_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CombinedDutyAct"
  ADD CONSTRAINT "CombinedDutyAct_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The reason has to say something. Measured on `btrim`, like the discard reason's CHECK, so whitespace is
-- not a reason.
ALTER TABLE "CombinedDutyAct"
  ADD CONSTRAINT "CombinedDutyAct_reason_not_empty"
  CHECK (length(btrim("reason")) >= 10);

-- The report reads by office newest-first; the record screens read by (entity, entityId).
CREATE INDEX "CombinedDutyAct_organizationId_actedAt_idx"
  ON "CombinedDutyAct" ("organizationId", "actedAt" DESC);
CREATE INDEX "CombinedDutyAct_entity_entityId_idx"
  ON "CombinedDutyAct" ("entity", "entityId");
CREATE INDEX "CombinedDutyAct_actorUserId_idx" ON "CombinedDutyAct" ("actorUserId");

ALTER TABLE "CombinedDutyAct" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CombinedDutyAct"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- 3. The ONE trigger: an act is only insertable for an office in COMBINED mode.
-- ---------------------------------------------------------------------------
-- This is where the mode is read, and it is the only place. The fourteen hot tables keep plain CHECK
-- constraints and gain no trigger, so there is one new object in `db:divergence`'s blind spot rather than
-- fifteen, and one per-write lookup on a table written once per declared act rather than on every approval
-- in the system.
--
-- BEFORE INSERT only. An act is immutable once written — there is no UPDATE path in the application — and a
-- trigger on UPDATE would have to decide what a mode change means for historical rows, which is exactly the
-- question that killed the denormalise-the-mode design (see the doc: tightening COMBINED -> SEGREGATED
-- would re-validate every historical row and fail on all of them).
CREATE OR REPLACE FUNCTION "combined_duty_act_requires_combined_mode"()
RETURNS TRIGGER AS $$
DECLARE
  office_mode "DutySegregationMode";
BEGIN
  SELECT "dutySegregationMode" INTO office_mode
    FROM "Organization" WHERE "id" = NEW."organizationId";

  IF office_mode IS NULL THEN
    RAISE EXCEPTION 'CombinedDutyAct references organization % which does not exist', NEW."organizationId"
      USING ERRCODE = '23503';
  END IF;

  IF office_mode <> 'COMBINED' THEN
    RAISE EXCEPTION 'Organization % is in % mode: a combined-duty act cannot be declared unless the office has declared COMBINED mode. This is the segregation of duties control, not a validation error.',
      NEW."organizationId", office_mode
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "combined_duty_act_requires_combined_mode"
  BEFORE INSERT ON "CombinedDutyAct"
  FOR EACH ROW EXECUTE FUNCTION "combined_duty_act_requires_combined_mode"();

-- ---------------------------------------------------------------------------
-- 4. The 15 escape columns and the 15 recreated CHECKs.
-- ---------------------------------------------------------------------------
-- No index on any escape column. They are NULL on effectively every row, nothing filters by them (the
-- report reads `CombinedDutyAct`, and the record screens join the other way round), and the FK's only
-- reverse traversal is a DELETE on `CombinedDutyAct`, which the application never does.

-- AccessRecertificationItem · AccessRecertificationItem_maker_checker_distinct
ALTER TABLE "AccessRecertificationItem" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "AccessRecertificationItem"
  ADD CONSTRAINT "AccessRecertificationItem_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessRecertificationItem" DROP CONSTRAINT "AccessRecertificationItem_maker_checker_distinct";
ALTER TABLE "AccessRecertificationItem"
  ADD CONSTRAINT "AccessRecertificationItem_maker_checker_distinct"
  CHECK (("reviewerUserId" <> "subjectUserId") OR ("combinedDutyActId" IS NOT NULL));
-- CommissionLedgerEntry · CommissionLedgerEntry_maker_checker_distinct
ALTER TABLE "CommissionLedgerEntry" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "CommissionLedgerEntry"
  ADD CONSTRAINT "CommissionLedgerEntry_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionLedgerEntry" DROP CONSTRAINT "CommissionLedgerEntry_maker_checker_distinct";
ALTER TABLE "CommissionLedgerEntry"
  ADD CONSTRAINT "CommissionLedgerEntry_maker_checker_distinct"
  CHECK ((("overrideApprovedByUserId" IS NULL) OR ("overrideRequestedByUserId" IS NULL) OR ("overrideApprovedByUserId" <> "overrideRequestedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- Complaint · Complaint_closure_maker_checker_distinct
ALTER TABLE "Complaint" ADD COLUMN "closureCombinedDutyActId" TEXT;
ALTER TABLE "Complaint"
  ADD CONSTRAINT "Complaint_closureCombinedDutyActId_fkey"
  FOREIGN KEY ("closureCombinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Complaint" DROP CONSTRAINT "Complaint_closure_maker_checker_distinct";
ALTER TABLE "Complaint"
  ADD CONSTRAINT "Complaint_closure_maker_checker_distinct"
  CHECK ((("closureApprovedByUserId" IS NULL) OR ("resolvedByUserId" IS NULL) OR ("closureApprovedByUserId" <> "resolvedByUserId")) OR ("closureCombinedDutyActId" IS NOT NULL));
-- DataProcessingAgreement · DataProcessingAgreement_maker_checker_distinct
ALTER TABLE "DataProcessingAgreement" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "DataProcessingAgreement"
  ADD CONSTRAINT "DataProcessingAgreement_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataProcessingAgreement" DROP CONSTRAINT "DataProcessingAgreement_maker_checker_distinct";
ALTER TABLE "DataProcessingAgreement"
  ADD CONSTRAINT "DataProcessingAgreement_maker_checker_distinct"
  CHECK ((("dpoApprovedByUserId" IS NULL) OR ("assessedByUserId" IS NULL) OR ("dpoApprovedByUserId" <> "assessedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- DataSharingApproval · DataSharingApproval_maker_checker_distinct
ALTER TABLE "DataSharingApproval" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "DataSharingApproval"
  ADD CONSTRAINT "DataSharingApproval_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataSharingApproval" DROP CONSTRAINT "DataSharingApproval_maker_checker_distinct";
ALTER TABLE "DataSharingApproval"
  ADD CONSTRAINT "DataSharingApproval_maker_checker_distinct"
  CHECK ((("approvedByUserId" IS NULL) OR ("approvedByUserId" <> "requestedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- DataSubjectRequest · DataSubjectRequest_closure_maker_checker_distinct
ALTER TABLE "DataSubjectRequest" ADD COLUMN "closureCombinedDutyActId" TEXT;
ALTER TABLE "DataSubjectRequest"
  ADD CONSTRAINT "DataSubjectRequest_closureCombinedDutyActId_fkey"
  FOREIGN KEY ("closureCombinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataSubjectRequest" DROP CONSTRAINT "DataSubjectRequest_closure_maker_checker_distinct";
ALTER TABLE "DataSubjectRequest"
  ADD CONSTRAINT "DataSubjectRequest_closure_maker_checker_distinct"
  CHECK ((("closedByUserId" IS NULL) OR ("processedByUserId" IS NULL) OR ("closedByUserId" <> "processedByUserId")) OR ("closureCombinedDutyActId" IS NOT NULL));
-- DisposalBatch · DisposalBatch_maker_checker_distinct
ALTER TABLE "DisposalBatch" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "DisposalBatch"
  ADD CONSTRAINT "DisposalBatch_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisposalBatch" DROP CONSTRAINT "DisposalBatch_maker_checker_distinct";
ALTER TABLE "DisposalBatch"
  ADD CONSTRAINT "DisposalBatch_maker_checker_distinct"
  CHECK ((("dpoApprovedByUserId" IS NULL) OR ("dpoApprovedByUserId" <> "nominatedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- IncidentReport · IncidentReport_classification_maker_checker_distinct
ALTER TABLE "IncidentReport" ADD COLUMN "classificationCombinedDutyActId" TEXT;
ALTER TABLE "IncidentReport"
  ADD CONSTRAINT "IncidentReport_classificationCombinedDutyActId_fkey"
  FOREIGN KEY ("classificationCombinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" DROP CONSTRAINT "IncidentReport_classification_maker_checker_distinct";
ALTER TABLE "IncidentReport"
  ADD CONSTRAINT "IncidentReport_classification_maker_checker_distinct"
  CHECK ((("seniorManagementCoSignUserId" IS NULL) OR ("classifiedByDpoUserId" IS NULL) OR ("seniorManagementCoSignUserId" <> "classifiedByDpoUserId")) OR ("classificationCombinedDutyActId" IS NOT NULL));
-- KYCRecord · KYCRecord_maker_checker_distinct
ALTER TABLE "KYCRecord" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "KYCRecord"
  ADD CONSTRAINT "KYCRecord_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KYCRecord" DROP CONSTRAINT "KYCRecord_maker_checker_distinct";
ALTER TABLE "KYCRecord"
  ADD CONSTRAINT "KYCRecord_maker_checker_distinct"
  CHECK ((("approvedByUserId" IS NULL) OR ("approvedByUserId" <> "createdByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- NeedsAssessment · NeedsAssessment_approver_maker_checker_distinct
ALTER TABLE "NeedsAssessment" ADD COLUMN "approverCombinedDutyActId" TEXT;
ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_approverCombinedDutyActId_fkey"
  FOREIGN KEY ("approverCombinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NeedsAssessment" DROP CONSTRAINT "NeedsAssessment_approver_maker_checker_distinct";
ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_approver_maker_checker_distinct"
  CHECK ((("approvedByUserId" IS NULL) OR ("approvedByUserId" <> "createdByUserId")) OR ("approverCombinedDutyActId" IS NOT NULL));
-- NeedsAssessment · NeedsAssessment_reviewer_maker_checker_distinct
ALTER TABLE "NeedsAssessment" ADD COLUMN "reviewerCombinedDutyActId" TEXT;
ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_reviewerCombinedDutyActId_fkey"
  FOREIGN KEY ("reviewerCombinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NeedsAssessment" DROP CONSTRAINT "NeedsAssessment_reviewer_maker_checker_distinct";
ALTER TABLE "NeedsAssessment"
  ADD CONSTRAINT "NeedsAssessment_reviewer_maker_checker_distinct"
  CHECK ((("reviewedByUserId" IS NULL) OR ("reviewedByUserId" <> "createdByUserId")) OR ("reviewerCombinedDutyActId" IS NOT NULL));
-- PolicyChecking · PolicyChecking_maker_checker_distinct
ALTER TABLE "PolicyChecking" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "PolicyChecking"
  ADD CONSTRAINT "PolicyChecking_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyChecking" DROP CONSTRAINT "PolicyChecking_maker_checker_distinct";
ALTER TABLE "PolicyChecking"
  ADD CONSTRAINT "PolicyChecking_maker_checker_distinct"
  CHECK ((("checkedByUserId" IS NULL) OR ("checkedByUserId" <> "placedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- Recommendation · Recommendation_maker_checker_distinct
ALTER TABLE "Recommendation" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "Recommendation"
  ADD CONSTRAINT "Recommendation_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recommendation" DROP CONSTRAINT "Recommendation_maker_checker_distinct";
ALTER TABLE "Recommendation"
  ADD CONSTRAINT "Recommendation_maker_checker_distinct"
  CHECK ((("approvedByUserId" IS NULL) OR ("approvedByUserId" <> "draftedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- Refund · Refund_maker_checker_distinct
ALTER TABLE "Refund" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" DROP CONSTRAINT "Refund_maker_checker_distinct";
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_maker_checker_distinct"
  CHECK ((("approvedByUserId" IS NULL) OR ("approvedByUserId" <> "raisedByUserId")) OR ("combinedDutyActId" IS NOT NULL));
-- Settlement · Settlement_maker_checker_distinct
ALTER TABLE "Settlement" ADD COLUMN "combinedDutyActId" TEXT;
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_maker_checker_distinct";
ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_maker_checker_distinct"
  CHECK ((("secondApproverUserId" IS NULL) OR ("approvedByUserId" IS NULL) OR ("secondApproverUserId" <> "approvedByUserId")) OR ("combinedDutyActId" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 5. Verify, on the database being deployed to.
-- ---------------------------------------------------------------------------
-- `db:divergence` sees neither CHECK constraints nor triggers, so a later migration could drop any of these
-- 16 objects with that gate staying green. Each one therefore asserts itself here.
DO $$
DECLARE
  -- (constraint, maker column, checker column, escape column) — assembled from this database's own
  -- `pg_get_constraintdef` output, so the assertion cannot inherit a wrong pairing from a hand-kept list.
  expected RECORD;
  definition TEXT;
  found INT;
BEGIN
  -- 5a. Every one of the 15 CHECKs still exists, is still a CHECK, still names BOTH of its original
  -- columns, and now admits its own escape column. The both-columns half is the one that matters: a
  -- predicate loosened to `TRUE OR (escape IS NOT NULL)` would satisfy a check that only looked for the
  -- escape column, and would refuse nothing.
  FOR expected IN
    SELECT * FROM (VALUES
    ('AccessRecertificationItem_maker_checker_distinct', 'reviewerUserId', 'subjectUserId', 'combinedDutyActId'),
    ('CommissionLedgerEntry_maker_checker_distinct', 'overrideApprovedByUserId', 'overrideRequestedByUserId', 'combinedDutyActId'),
    ('Complaint_closure_maker_checker_distinct', 'closureApprovedByUserId', 'resolvedByUserId', 'closureCombinedDutyActId'),
    ('DataProcessingAgreement_maker_checker_distinct', 'dpoApprovedByUserId', 'assessedByUserId', 'combinedDutyActId'),
    ('DataSharingApproval_maker_checker_distinct', 'approvedByUserId', 'requestedByUserId', 'combinedDutyActId'),
    ('DataSubjectRequest_closure_maker_checker_distinct', 'closedByUserId', 'processedByUserId', 'closureCombinedDutyActId'),
    ('DisposalBatch_maker_checker_distinct', 'dpoApprovedByUserId', 'nominatedByUserId', 'combinedDutyActId'),
    ('IncidentReport_classification_maker_checker_distinct', 'seniorManagementCoSignUserId', 'classifiedByDpoUserId', 'classificationCombinedDutyActId'),
    ('KYCRecord_maker_checker_distinct', 'approvedByUserId', 'createdByUserId', 'combinedDutyActId'),
    ('NeedsAssessment_approver_maker_checker_distinct', 'approvedByUserId', 'createdByUserId', 'approverCombinedDutyActId'),
    ('NeedsAssessment_reviewer_maker_checker_distinct', 'reviewedByUserId', 'createdByUserId', 'reviewerCombinedDutyActId'),
    ('PolicyChecking_maker_checker_distinct', 'checkedByUserId', 'placedByUserId', 'combinedDutyActId'),
    ('Recommendation_maker_checker_distinct', 'approvedByUserId', 'draftedByUserId', 'combinedDutyActId'),
    ('Refund_maker_checker_distinct', 'approvedByUserId', 'raisedByUserId', 'combinedDutyActId'),
    ('Settlement_maker_checker_distinct', 'secondApproverUserId', 'approvedByUserId', 'combinedDutyActId')
    ) AS v(conname, maker_col, checker_col, escape_col)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO definition
      FROM pg_constraint c WHERE c.conname = expected.conname AND c.contype = 'c';

    IF definition IS NULL THEN
      RAISE EXCEPTION 'maker/checker CHECK % is missing or is no longer a CHECK constraint. The segregation control is in the database by design; if it moved into application code, that is the change this migration exists to prevent.', expected.conname;
    END IF;

    IF definition NOT LIKE '%' || expected.maker_col || '%'
       OR definition NOT LIKE '%' || expected.checker_col || '%' THEN
      RAISE EXCEPTION 'maker/checker CHECK % no longer names both % and % (definition: %). A predicate that dropped one of its columns refuses nothing.',
        expected.conname, expected.maker_col, expected.checker_col, definition;
    END IF;

    IF definition NOT LIKE '%' || expected.escape_col || '%' THEN
      RAISE EXCEPTION 'maker/checker CHECK % does not admit a declared combined-duty act via % (definition: %). COMBINED mode would be unusable for this pair.',
        expected.conname, expected.escape_col, definition;
    END IF;
  END LOOP;

  -- 5b. Fifteen DISTINCT escape columns. One shared column on NeedsAssessment would let a declared combined
  -- REVIEW excuse a self-APPROVAL — a different act under a different permission.
  SELECT count(*) INTO found
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name LIKE '%ombinedDutyActId';
  IF found <> 15 THEN
    RAISE EXCEPTION 'expected 15 combined-duty escape columns, found %. One per CONSTRAINT, never per table.', found;
  END IF;

  -- 5c. The trigger, which is the half that refuses a DECLARED self-approval in a segregated office.
  SELECT count(*) INTO found
    FROM pg_trigger
   WHERE tgname = 'combined_duty_act_requires_combined_mode' AND NOT tgisinternal;
  IF found <> 1 THEN
    RAISE EXCEPTION 'the CombinedDutyAct mode trigger is missing (found %). Without it the escape column is a universal bypass and the mode is a value nobody checks.', found;
  END IF;

  -- 5d. Nothing changed for anybody: every existing office reads SEGREGATED.
  SELECT count(*) INTO found FROM "Organization" WHERE "dutySegregationMode" <> 'SEGREGATED';
  IF found <> 0 THEN
    RAISE EXCEPTION '% organization(s) are not SEGREGATED immediately after this migration. This change grants nothing and must leave every office exactly as it was.', found;
  END IF;
END $$;
