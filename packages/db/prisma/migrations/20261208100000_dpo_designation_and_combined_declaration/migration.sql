-- MODULE 0-ب — THE DPO DESIGNATION, AND THE DECLARATION WHEN ONE PERSON HOLDS BOTH ASSIGNMENTS.
--
-- ## WHAT WAS MEASURED FIRST, BECAUSE THE ITEM COULD NOT START WITHOUT IT
--
-- The owner's instruction was to measure whether the DPO assignment exists as a stored object at
-- all before writing a line, on the reasoning that decision 80 makes an assignment A NAME AND A
-- REFERENCE — not an account and not a code bundle — so the declaration reads the two DESIGNATIONS
-- rather than anybody's permissions.
--
-- Measured across the whole schema:
--
--   * THE OFFICE MANAGER designation EXISTS — `Organization.generalManagerName`, free text, written
--     once by the PROVIDER at registration (field dictionary row 24, `gm_name`).
--   * THE COMPLIANCE OFFICER designation EXISTS — `complianceOfficerName` plus an email and a phone
--     (row 25).
--   * THE DATA PROTECTION OFFICER designation DID NOT EXIST. Four `dpo*` columns exist and NOT ONE
--     is a designation: `dpoAlternateApproverUserId` (the disposal edge-case fallback),
--     `dpoHandlerUserId` (per data-subject request), `classifiedByDpoUserId` (per incident) and
--     `dpoApprovedByUserId` (per disposal batch / per agreement / per screening). Every one is
--     per-RECORD or per-ACT.
--
-- And `DATA_PROTECTION_OFFICER` is a ROLE — which is a code bundle, the thing decision 80 says an
-- assignment is not. So the item starts here: the designation becomes a stored object, and the
-- declaration rides on it.
--
-- ## THE DECISION THIS IMPLEMENTS — AND IT REVERSES A RECORDED ONE
--
-- The repository previously recorded a HARD BLOCK: the holder of the DPO assignment may not be the
-- holder of the office-manager assignment. THE OWNER HAS STRUCK THAT. One person MAY hold both; an
-- office of one person does not contain two people, and the system will not demand what the office
-- does not have.
--
-- So this REFUSES NOTHING ABOUT THE ARRANGEMENT. Both routes stay open and neither is required —
-- the office may assign the DPO to a second person inside it, to somebody outside it, or to the
-- manager himself. What is added is that the system says so ONCE and records that it was known.
--
-- ## AN ACKNOWLEDGEMENT, AND NO WRITTEN REASON — DELIBERATELY LIGHTER THAN DECISION 28
--
-- Decision 28's family (the no-floor retention declaration) asks for a written reason as well. Here
-- the reason is the SAME EVERY TIME — "I am one person" — so a reason box would be answered
-- identically and become the wallpaper the owner's own rule exists to prevent. Four columns, not
-- five.
--
-- ## IT RECORDS WHO IT WAS ABOUT, WHICH IS WHAT MAKES "ASKED ONCE" HONEST
--
-- `dpoManagerCombinedAcknowledgedPerson` holds the CANONICAL KEY of the person the acknowledgement
-- was about — `canonicalNameKey`, the same fold the employee and insurer duplicate indexes use, so
-- there is one answer in this system to "are these two names the same person" rather than two.
--
-- The `noFloorAcknowledgedMonths` precedent and the same argument: without it, an office that
-- acknowledged the combination for person A and later assigned both functions to person B would be
-- shown nothing, because an acknowledgement exists. The exposure is about a DIFFERENT person, so it
-- asks again. And when the two designations stop coinciding it is not shown at all.
--
-- ## PLAIN IDS, NOT FOREIGN KEYS — the established treatment on THIS table
--
-- `createdByUserId`, `updatedByUserId` and `dpoAlternateApproverUserId` are all plain ids here, and
-- the recorded reason is structural rather than about tenancy: a second `Organization`<->`User`
-- relation would force every other relation in `schema.prisma` to be explicitly named. The
-- acknowledger is this office's own user, so an FK would be valid — and inconsistent with its three
-- siblings for no gain.
--
-- ## NO DEFAULT ON THE DESIGNATION, AND NULLABLE
--
-- Nullable because three organizations predate it and because an insurance company's own record is
-- read-only in this product (its registration form has no DPO field), so there is no write path that
-- could fill one. A DEFAULT would turn "nobody has recorded a DPO" into a name, which is the
-- invented-value class this module has refused four times.

ALTER TABLE "Organization"
  ADD COLUMN "dataProtectionOfficerName" TEXT,
  ADD COLUMN "dpoManagerCombinedNoticeShown" TEXT,
  ADD COLUMN "dpoManagerCombinedAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "dpoManagerCombinedAcknowledgedByUserId" TEXT,
  ADD COLUMN "dpoManagerCombinedAcknowledgedPerson" TEXT;

-- ALL FOUR OR NONE — the `RetentionScheduleItem_no_floor_declaration_complete` precedent and the
-- same argument: an acknowledgement missing the sentence shown, the actor or the person it was about
-- would let "acknowledged" mean "somebody ticked a box", which is exactly what recording the
-- sentence rather than the word exists to prevent.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_dpo_manager_combined_declaration_complete"
  CHECK (
    ("dpoManagerCombinedNoticeShown" IS NULL
      AND "dpoManagerCombinedAcknowledgedAt" IS NULL
      AND "dpoManagerCombinedAcknowledgedByUserId" IS NULL
      AND "dpoManagerCombinedAcknowledgedPerson" IS NULL)
    OR ("dpoManagerCombinedNoticeShown" IS NOT NULL
      AND "dpoManagerCombinedAcknowledgedAt" IS NOT NULL
      AND "dpoManagerCombinedAcknowledgedByUserId" IS NOT NULL
      AND "dpoManagerCombinedAcknowledgedPerson" IS NOT NULL)
  );

-- A declaration whose sentence or whose subject is an empty string satisfies the all-or-none rule
-- above and records nothing. The database refuses the degenerate case so that no code path, present
-- or future, can write a blank one.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_dpo_manager_combined_declaration_not_blank"
  CHECK (
    "dpoManagerCombinedNoticeShown" IS NULL
    OR (length(btrim("dpoManagerCombinedNoticeShown")) > 0
      AND length(btrim("dpoManagerCombinedAcknowledgedPerson")) > 0)
  );

DO $$
DECLARE
  cols INTEGER;
  defaulted INTEGER;
  complete_def TEXT;
  blank_def TEXT;
  declared INTEGER;
BEGIN
  SELECT count(*) INTO cols
  FROM information_schema.columns
  WHERE table_name = 'Organization'
    AND column_name IN (
      'dataProtectionOfficerName',
      'dpoManagerCombinedNoticeShown',
      'dpoManagerCombinedAcknowledgedAt',
      'dpoManagerCombinedAcknowledgedByUserId',
      'dpoManagerCombinedAcknowledgedPerson'
    );
  IF cols <> 5 THEN
    RAISE EXCEPTION 'expected 5 new columns, found %', cols;
  END IF;

  -- NO DEFAULT ON ANY OF THE FIVE. A default on the designation invents a name; a default on an
  -- acknowledgement column makes an unacknowledged office read as acknowledged, which is worse.
  -- Asserted off `pg_attrdef` rather than read off the statement above, because the statement is
  -- what a later migration edits.
  SELECT count(*) INTO defaulted
  FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = '"Organization"'::regclass
    AND a.attname IN (
      'dataProtectionOfficerName',
      'dpoManagerCombinedNoticeShown',
      'dpoManagerCombinedAcknowledgedAt',
      'dpoManagerCombinedAcknowledgedByUserId',
      'dpoManagerCombinedAcknowledgedPerson'
    );
  IF defaulted <> 0 THEN
    RAISE EXCEPTION '% of the new columns carry a DEFAULT; none may', defaulted;
  END IF;

  -- The CHECKs are asserted by their DEFINITION rather than by their existence. A predicate
  -- loosened to `TRUE OR (...)` keeps the constraint name and refuses nothing — the plant that
  -- proved `broker-kind.e2e-spec.ts`'s definition check secondary and its refusal tests primary.
  SELECT pg_get_constraintdef(oid) INTO complete_def
  FROM pg_constraint
  WHERE conname = 'Organization_dpo_manager_combined_declaration_complete';
  IF complete_def IS NULL THEN
    RAISE EXCEPTION 'the all-four-or-none CHECK does not exist';
  END IF;
  IF complete_def NOT LIKE '%dpoManagerCombinedNoticeShown%'
     OR complete_def NOT LIKE '%dpoManagerCombinedAcknowledgedAt%'
     OR complete_def NOT LIKE '%dpoManagerCombinedAcknowledgedByUserId%'
     OR complete_def NOT LIKE '%dpoManagerCombinedAcknowledgedPerson%' THEN
    RAISE EXCEPTION 'the all-four-or-none CHECK no longer names all four columns — it reads %', complete_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO blank_def
  FROM pg_constraint
  WHERE conname = 'Organization_dpo_manager_combined_declaration_not_blank';
  IF blank_def IS NULL THEN
    RAISE EXCEPTION 'the not-blank CHECK does not exist';
  END IF;
  IF blank_def NOT LIKE '%btrim%' THEN
    RAISE EXCEPTION 'the not-blank CHECK no longer trims — it reads %', blank_def;
  END IF;

  -- NO ROW IS DECLARED BY THIS MIGRATION, and that is the point rather than a side effect: an
  -- acknowledgement is a fact about a person reading a sentence, and a backfilled one would be this
  -- system asserting that somebody read something they have never seen.
  SELECT count(*) INTO declared
  FROM "Organization"
  WHERE "dpoManagerCombinedAcknowledgedAt" IS NOT NULL;
  IF declared <> 0 THEN
    RAISE EXCEPTION '% organization(s) came out of this migration already declared; none may', declared;
  END IF;

  RAISE NOTICE 'DPO designation added; 5 columns, no defaults, both CHECKs asserted by definition, 0 rows declared';
END $$;
