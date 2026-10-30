-- MODULE 0 CLOSE, DECISION 3 — THE RETENTION SCHEDULE BECOMES THE SIXTEENTH MAKER/CHECKER PAIR.
--
-- ## WHY SPLITTING THE CODES ALONE WOULD HAVE BEEN WORSE THAN DOING NOTHING
--
-- The owner's instruction: "Splitting the codes alone would leave two codes with no enforcement —
-- separated in appearance only, which is the class of defect this close was spent on." Measured, and
-- that is exactly the state this table was in:
--
--   `RetentionScheduleItem` carries `recordCategory`, `retentionPeriodMonths`, `legalBasis` — the EDIT
--   — and `confirmedByLegalCounselAt`, a CONFIRM step that records a DATE AND NO ACTOR. Both halves
--   were gated on the single code `retention-schedule.manage`.
--
-- So there was nothing to compare: no maker column, no checker column, and therefore no constraint a
-- split could have been enforced by. Two codes over one unactored timestamp would have put
-- "separation of duties" on a screen and nothing behind it.
--
-- ## WHAT THIS ADDS, AND WHY EACH COLUMN EXISTS
--
--   `setByUserId`                        — the MAKER. Who set this retention period. NOT NULL is not
--                                          possible: four rows already exist and nobody recorded who
--                                          set them, and inventing an actor for a compliance decision
--                                          is the lie the column exists to prevent.
--   `confirmedByLegalCounselByUserId`    — the CHECKER. The actor the existing date never had.
--   `combinedDutyActId`                  — the escape column, so a declared one-person office can do
--                                          both halves WITH THE ACT RECORDED. Every one of the fifteen
--                                          existing pairs carries one; a sixteenth without it would be
--                                          the one pair a COMBINED office could not perform at all.
--
-- ## THE CHECK IS THE SAME SHAPE AS THE OTHER FIFTEEN, COPIED FROM THE DATABASE
--
-- Read off `pg_get_constraintdef` for `DisposalBatch_maker_checker_distinct` rather than retyped from
-- memory — the predicates do not share one shape across the fifteen, and re-deriving one from a
-- template is how a constraint comes back looser than it went in.
--
-- ## WHY A DATE IS NOT ENOUGH, STATED BECAUSE THE DATE ALREADY EXISTED
--
-- `confirmedByLegalCounselAt` says a confirmation happened. It cannot say WHO, so it cannot say the
-- confirmer was not the person who set the period — which is the whole point of a maker/checker pair
-- on a retention schedule: the period decides when customer records are destroyed, and one person
-- choosing it and confirming it alone is the shape PRIV-SRS-01 M06 exists to prevent.

ALTER TABLE "RetentionScheduleItem"
  ADD COLUMN "setByUserId" TEXT,
  ADD COLUMN "confirmedByLegalCounselByUserId" TEXT,
  ADD COLUMN "combinedDutyActId" TEXT;

ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_setByUserId_fkey"
  FOREIGN KEY ("setByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_confirmedByLegalCounselByUserId_fkey"
  FOREIGN KEY ("confirmedByLegalCounselByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- `onDelete: Restrict` EXPLICITLY, like all fifteen siblings: Prisma's default for an optional
-- relation is `SetNull`, and a declaration that disagreed with the database is a class this repo has
-- already been bitten by. A nulled escape column would silently turn a declared combined act back
-- into an unexplained self-approval.
ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_combinedDutyActId_fkey"
  FOREIGN KEY ("combinedDutyActId") REFERENCES "CombinedDutyAct"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_maker_checker_distinct"
  CHECK (
    ("confirmedByLegalCounselByUserId" IS NULL)
    OR ("confirmedByLegalCounselByUserId" <> "setByUserId")
    OR ("combinedDutyActId" IS NOT NULL)
  );

-- A DATE WITHOUT AN ACTOR IS REFUSED GOING FORWARD — `NOT VALID`, AND THE REASON IS A CORRECTION.
--
-- THE FIRST VERSION OF THIS MIGRATION ASSERTED IN A COMMENT that all four existing rows carry a NULL
-- confirmation date, "measured below". IT WAS NOT MEASURED, and the database refused the migration:
--
--   ERROR: check constraint "RetentionScheduleItem_confirmation_carries_its_actor" is violated by
--          some row
--
-- Measured properly afterwards, on db-test: FOUR rows, and TWO carry a confirmation date with no
-- actor — `E2E-Category-gsqpbn` (2026-10-02) and `dual-role-1790961560275` (2026-10-02), both e2e
-- leftovers. Dev holds ONE row with no date. So the claim was false on the database it ran against,
-- and writing it in a comment is the exact defect class this module's close was spent correcting.
--
-- `NOT VALID` binds every new row and exempts the two that exist — the `Insurer_rating_carries_its_date`
-- precedent from item (e). It is NOT validated afterwards here, deliberately: validating would
-- require stamping an actor onto two confirmations nobody can source, and inventing an actor for a
-- compliance confirmation is precisely the lie the actor column exists to prevent. The exemption is
-- two leftover test rows; on a database built from nothing there is nothing to exempt.
--
-- Deliberately NOT the reverse (an actor with no date): the service stamps both in one write, and a
-- constraint on that pairing would be a second home for a rule one function already owns.
ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_confirmation_carries_its_actor"
  CHECK (
    ("confirmedByLegalCounselAt" IS NULL AND "confirmedByLegalCounselByUserId" IS NULL)
    OR ("confirmedByLegalCounselAt" IS NOT NULL AND "confirmedByLegalCounselByUserId" IS NOT NULL)
  ) NOT VALID;

CREATE INDEX "RetentionScheduleItem_combinedDutyActId_idx"
  ON "RetentionScheduleItem"("combinedDutyActId");

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- (1) The composite tenant foreign keys are all still there.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) THE PAIR COUNT MOVED FROM 15 TO 16, which is the whole point of the migration and is the one
  --     thing a reader would check. `maker-checker-pairs.e2e-spec.ts` derives its expected SET from
  --     `pg_constraint`, so this number and that spec cannot disagree for long — but a migration that
  --     silently failed to add the constraint would leave the split codes enforcing nothing, which is
  --     precisely the defect the owner refused.
  SELECT count(*) INTO n FROM pg_constraint WHERE conname LIKE '%maker\_checker%';
  IF n <> 16 THEN
    RAISE EXCEPTION 'expected 16 maker/checker constraints after this migration, found %', n;
  END IF;

  -- (3) THE PREDICATE NAMES ALL THREE COLUMNS. A CHECK loosened to `TRUE OR (…)` still "exists" and
  --     still names its columns, which is why item (b) learned to assert the DEFINITION rather than
  --     the presence — and then to prove the refusal separately, which test (5) below does.
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'RetentionScheduleItem_maker_checker_distinct';
  IF def IS NULL THEN
    RAISE EXCEPTION 'RetentionScheduleItem_maker_checker_distinct does not exist';
  END IF;
  IF def NOT LIKE '%setByUserId%'
     OR def NOT LIKE '%confirmedByLegalCounselByUserId%'
     OR def NOT LIKE '%combinedDutyActId%' THEN
    RAISE EXCEPTION 'the maker/checker predicate no longer names all three columns — it reads %', def;
  END IF;

  -- (4) ZERO ROWS CHANGED. Every pre-existing row comes out with both ACTOR columns NULL — which is
  --     the honest state, because nobody recorded who set them. What is NOT claimed here any more is
  --     that their confirmation DATE is null: two db-test rows carry one, which is why the pairing
  --     constraint above is `NOT VALID` (see its note).
  SELECT count(*) INTO n FROM "RetentionScheduleItem"
   WHERE "setByUserId" IS NOT NULL
      OR "confirmedByLegalCounselByUserId" IS NOT NULL
      OR "combinedDutyActId" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% RetentionScheduleItem row(s) came out of this migration carrying an actor — nothing here writes one', n;
  END IF;

  -- (5) THE REFUSAL IS PROVEN BY ATTEMPTING IT, in a rolled-back sub-transaction, because a
  --     constraint that exists and refuses nothing is the failure mode item (b) measured. Needs a
  --     real user id and a real office, so it is skipped where the seed has not run — and SAYS SO,
  --     rather than passing quietly.
  DECLARE
    u   TEXT;
    org TEXT;
  BEGIN
    SELECT id INTO u FROM "User" LIMIT 1;
    SELECT id INTO org FROM "Organization" WHERE "type" = 'BROKERAGE_OFFICE' LIMIT 1;
    IF u IS NULL OR org IS NULL THEN
      RAISE NOTICE 'refusal NOT proven: no user or no brokerage office exists yet (run the seed). The constraint is in place; this probe needs rows.';
    ELSE
      BEGIN
        INSERT INTO "RetentionScheduleItem"
          (id, "organizationId", "recordCategory", "retentionPeriodMonths",
           "setByUserId", "confirmedByLegalCounselAt", "confirmedByLegalCounselByUserId")
        VALUES
          (gen_random_uuid()::text, org, 'probe-self-confirmed-' || gen_random_uuid()::text, 12,
           u, now(), u);
        RAISE EXCEPTION 'A SELF-CONFIRMED retention period was accepted — the maker/checker constraint refuses nothing';
      EXCEPTION
        WHEN check_violation THEN
          RAISE NOTICE 'refusal proven: one person cannot both set and confirm a retention period';
      END;
    END IF;
  END;

  RAISE NOTICE 'retention schedule: maker, checker and escape columns added; 16 maker/checker constraints';
END $$;
