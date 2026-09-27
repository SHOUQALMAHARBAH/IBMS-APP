-- Reviewing your own access, part 2 of 2 — the act ON the review, not only on the arrangement.
--
-- The owner chose Option 2 from `docs/decision-reviewing-your-own-access.md`, for the reason the brief
-- gave: Option 1 records an ARRANGEMENT rather than an ACT, carries the wrong date, and says nothing
-- about whether the review ever happened.
--
-- WHY A SECOND COLUMN AND NOT A REUSED ONE
-- ----------------------------------------
-- `AccessRecertificationItem` is the one pair in this system decided by an INSERT: the reviewer is
-- assigned when the cycle OPENS, and `reviewerUserId` is NOT NULL with no null guard in the CHECK. So in a
-- one-person office the self-review happens at the moment the round is opened, before anything has been
-- reviewed — which is exactly the mismatch that made this a decision rather than an implementation.
--
-- `combinedDutyActId` already exists and is the CHECK's escape: it records that she was SET TO review her
-- own access, and it is what lets the INSERT happen at all. This adds
-- `decisionCombinedDutyActId`, which records that she DID review it, dated to the review.
--
-- Two columns for two facts, which is the same shape `NeedsAssessment` already carries (a reviewer act and
-- an approver act), and for the same reason: one shared column would let a declared act on one half excuse
-- the other half.
--
-- THE CHECK IS DELIBERATELY NOT WIDENED
-- ------------------------------------
-- `AccessRecertificationItem_maker_checker_distinct` guards `reviewerUserId <> subjectUserId` with
-- `combinedDutyActId IS NOT NULL` as its disjunct, and that is satisfied at INSERT time by act 1. Act 2
-- cannot make a self-review legal that was not already legal, so adding it as a second disjunct would
-- LOOSEN the constraint for no gain — a second way to satisfy a check that is already satisfied.
--
-- The new column is evidentiary, and the evidence is the point: the self-approval report reads it to print
-- the flagged line dated to the review. Its FK to `CombinedDutyAct` is what makes it evidence rather than a
-- free-text claim, and the trigger on `CombinedDutyAct` still refuses an act in a SEGREGATED office.

ALTER TABLE "AccessRecertificationItem"
  ADD COLUMN "decisionCombinedDutyActId" TEXT;

ALTER TABLE "AccessRecertificationItem"
  ADD CONSTRAINT "AccessRecertificationItem_decisionCombinedDutyActId_fkey"
  FOREIGN KEY ("decisionCombinedDutyActId") REFERENCES "CombinedDutyAct"("id")
  -- RESTRICT, explicitly. Prisma's default for an optional relation is SetNull, and the database says
  -- RESTRICT for all fifteen existing escape columns; `db:divergence` flags exactly this class, and an
  -- evidence pointer that silently becomes NULL is worse than a delete that is refused.
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AccessRecertificationItem_decisionCombinedDutyActId_idx"
  ON "AccessRecertificationItem"("decisionCombinedDutyActId");

-- ---------------------------------------------------------------------------
-- Prove the column is there, nullable, and pointed at the right table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  is_nullable text;
  fk_target text;
  fk_action text;
BEGIN
  SELECT c.is_nullable INTO is_nullable
  FROM information_schema.columns c
  WHERE c.table_name = 'AccessRecertificationItem'
    AND c.column_name = 'decisionCombinedDutyActId';
  IF is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION
      'decisionCombinedDutyActId must be NULLABLE: every ordinary two-person review leaves it null, and a NOT NULL column would refuse every existing row.';
  END IF;

  SELECT confrelid::regclass::text, confdeltype INTO fk_target, fk_action
  FROM pg_constraint
  WHERE conname = 'AccessRecertificationItem_decisionCombinedDutyActId_fkey';
  IF fk_target IS DISTINCT FROM '"CombinedDutyAct"' AND fk_target IS DISTINCT FROM 'CombinedDutyAct' THEN
    RAISE EXCEPTION 'the decision act FK points at % rather than CombinedDutyAct', fk_target;
  END IF;
  -- 'r' = RESTRICT. Asserted because the declared intent and the enforced behaviour have disagreed on an
  -- onDelete in this schema before, and the schema file was the half that was wrong.
  IF fk_action IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'the decision act FK must be ON DELETE RESTRICT (found %) — an evidence pointer must not silently become NULL', fk_action;
  END IF;
END $$;
