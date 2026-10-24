-- MODULE 0 CLOSE, batch 5 group 6 — THE SILENT CASE DECLARES.
--
-- ## WHAT WAS SILENT
--
-- Batch 5 group 5 built the statutory retention floor as a hard refusal over two record-category
-- families, and declared its own limit in the config header: `recordCategory` is FREE TEXT and the
-- floor fires only on a name the list recognises.
--
-- Measured, the consequence is concrete rather than theoretical: `CustomerFile` takes the five-year
-- floor and `Customer` takes NOTHING — no refusal and no word — and `Customer` is one of the
-- fourteen names that batch reported as unsourced. So a refusal the owner made HARD is escaped by a
-- spelling, SILENTLY.
--
-- ## THE OWNER'S RULING: IT DECLARES AND LOGS, IT DOES NOT REFUSE
--
-- By her own standing rule — the harm here is the office's OWN regulatory exposure rather than a
-- third party's — the save is ACCEPTED. What is added is a declaration: the office is shown a
-- sentence naming BOTH known floors with their instruments and articles, writes a reason, and ticks
-- an acknowledgement by hand.
--
-- THE NAMING OF BOTH FLOORS IS THE MECHANISM, NOT DECORATION. It is how somebody who is in fact
-- saving due-diligence records under a different name recognises what they are doing.
--
-- AND THE SENTENCE SAYS THE *SYSTEM* DOES NOT KNOW A MINIMUM FOR THAT NAME — never that the LAW
-- sets none. That distinction is the difference between an honest declaration and this product
-- making a legal claim it has no source for, and it is why the text is the owner's own and is
-- stored verbatim rather than paraphrased at any layer.
--
-- ## FIVE COLUMNS, AND THE PERIOD IS ONE OF THEM
--
-- `noFloorAcknowledgedMonths` is what makes "asked once" implementable without a second table: the
-- row is already UNIQUE on (organizationId, recordCategory), so the row IS the per-office
-- per-category record. A later save at the SAME or a LONGER period is not re-asked; SHORTENING asks
-- again, because the exposure changed.
--
-- `noFloorNoticeShown` stores THE SENTENCE THE OFFICE WAS SHOWN, carried from the client verbatim —
-- the `DuplicateNameWarning` precedent and its reasoning: re-deriving it at submit would silently
-- rewrite what they were told. A year from now the question is what they saw.

ALTER TABLE "RetentionScheduleItem"
  ADD COLUMN "noFloorNoticeShown" TEXT,
  ADD COLUMN "noFloorReason" TEXT,
  ADD COLUMN "noFloorAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "noFloorAcknowledgedByUserId" TEXT,
  ADD COLUMN "noFloorAcknowledgedMonths" INTEGER;

-- `onDelete: RESTRICT` EXPLICITLY. Prisma's default for an optional relation is `SetNull`, and a
-- nulled actor would leave a declaration nobody made — which is the whole thing this records.
ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_noFloorAcknowledgedByUserId_fkey"
  FOREIGN KEY ("noFloorAcknowledgedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RetentionScheduleItem_noFloorAcknowledgedByUserId_idx"
  ON "RetentionScheduleItem"("noFloorAcknowledgedByUserId");

-- ALL FIVE OR NONE — the `CustomerIdentifierCorrection_clerical_retention_complete` precedent, and
-- the same argument: a recorded acknowledgement with no sentence, no reason, nobody named or no
-- period would let "acknowledged" mean "somebody ticked a box", which is exactly what the owner
-- ruled out by requiring the sentence and the reason in the record rather than the word.
ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_no_floor_declaration_complete"
  CHECK (
    ("noFloorNoticeShown" IS NULL
      AND "noFloorReason" IS NULL
      AND "noFloorAcknowledgedAt" IS NULL
      AND "noFloorAcknowledgedByUserId" IS NULL
      AND "noFloorAcknowledgedMonths" IS NULL)
    OR ("noFloorNoticeShown" IS NOT NULL
      AND "noFloorReason" IS NOT NULL
      AND "noFloorAcknowledgedAt" IS NOT NULL
      AND "noFloorAcknowledgedByUserId" IS NOT NULL
      AND "noFloorAcknowledgedMonths" IS NOT NULL)
  );

-- A declaration with an EMPTY sentence or an empty reason satisfies the all-or-none rule above and
-- records nothing. The reason's floor is the application's (ten characters, the established
-- declaration minimum); the database refuses the degenerate case so that no code path, present or
-- future, can write a blank one.
ALTER TABLE "RetentionScheduleItem"
  ADD CONSTRAINT "RetentionScheduleItem_no_floor_declaration_not_blank"
  CHECK (
    "noFloorNoticeShown" IS NULL
    OR (length(btrim("noFloorNoticeShown")) > 0 AND length(btrim("noFloorReason")) > 0)
  );

DO $$
DECLARE
  cols INTEGER;
  complete_def TEXT;
  blank_def TEXT;
  existing INTEGER;
  acknowledged INTEGER;
BEGIN
  SELECT count(*) INTO cols
  FROM information_schema.columns
  WHERE table_name = 'RetentionScheduleItem'
    AND column_name IN (
      'noFloorNoticeShown', 'noFloorReason', 'noFloorAcknowledgedAt',
      'noFloorAcknowledgedByUserId', 'noFloorAcknowledgedMonths'
    );
  IF cols <> 5 THEN
    RAISE EXCEPTION 'expected 5 declaration columns, found %', cols;
  END IF;

  -- The CHECK is asserted by its DEFINITION rather than by its existence. A predicate loosened to
  -- `TRUE OR (...)` keeps the constraint name and refuses nothing — the exact plant that proved
  -- `broker-kind.e2e-spec.ts`'s definition check secondary and its refusal tests primary.
  SELECT pg_get_constraintdef(oid) INTO complete_def
  FROM pg_constraint
  WHERE conname = 'RetentionScheduleItem_no_floor_declaration_complete';
  IF complete_def IS NULL THEN
    RAISE EXCEPTION 'the all-five-or-none CHECK does not exist';
  END IF;
  IF complete_def NOT LIKE '%noFloorNoticeShown%'
     OR complete_def NOT LIKE '%noFloorReason%'
     OR complete_def NOT LIKE '%noFloorAcknowledgedAt%'
     OR complete_def NOT LIKE '%noFloorAcknowledgedByUserId%'
     OR complete_def NOT LIKE '%noFloorAcknowledgedMonths%' THEN
    RAISE EXCEPTION 'the all-five-or-none CHECK no longer names all five columns — it reads %', complete_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO blank_def
  FROM pg_constraint
  WHERE conname = 'RetentionScheduleItem_no_floor_declaration_not_blank';
  IF blank_def IS NULL OR blank_def NOT LIKE '%btrim%' THEN
    RAISE EXCEPTION 'the not-blank CHECK is missing or no longer trims — it reads %', blank_def;
  END IF;

  -- EVERY EXISTING ROW IS UNACKNOWLEDGED, and that is the correct state rather than a gap: no office
  -- has ever been shown this sentence, so none has acknowledged it. A row with a NULL
  -- `noFloorAcknowledgedMonths` has never been asked, which is why the application asks on the next
  -- period change rather than inventing a baseline to compare against.
  SELECT count(*) INTO existing FROM "RetentionScheduleItem";
  SELECT count(*) INTO acknowledged FROM "RetentionScheduleItem"
  WHERE "noFloorAcknowledgedAt" IS NOT NULL;
  IF acknowledged <> 0 THEN
    RAISE EXCEPTION '% row(s) came out acknowledged by a migration that acknowledges nothing', acknowledged;
  END IF;
  RAISE NOTICE 'no-floor declaration: 5 columns, 2 CHECKs, % existing row(s) all unacknowledged', existing;
END $$;
