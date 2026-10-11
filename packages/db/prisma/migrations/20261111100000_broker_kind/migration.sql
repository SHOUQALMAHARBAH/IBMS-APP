-- MODULE 0, ITEM (b): WHAT KIND OF BROKER THE OFFICE IS.
--
-- Created 2026-10-11, on top of item (a)'s `Organization.type`.
--
-- CBJ Instructions No. 9 of 2026, art. 3/a distinguishes a NATURAL PERSON broker (a sole
-- establishment — one person) from a CORPORATE one, and the distinction has a consequence rather
-- than being descriptive: a natural person may be licensed for ONE insurance type only, while a
-- corporate broker may hold both.
--
-- ============================================================================================
-- THIS MIGRATION DOES NOT ENFORCE THE ONE-TYPE RULE, AND SAYING SO IS THE POINT
-- ============================================================================================
-- It cannot. The rule is a constraint on the LICENCE SCOPE — which insurance types the office is
-- licensed for — and no column stores that yet; `BrokerLicense.scopeOfAuthorization` is a single
-- free-text field today. Item (e) is where types and branches become data, and that is where the
-- refusal belongs, against the thing it is about.
--
-- Recording the kind here and the rule there is deliberate sequencing, not an oversight: a CHECK
-- written now could only compare a kind against nothing. What this migration guarantees is that
-- when (e) arrives, every brokerage office already HAS a kind to check against.
--
-- ============================================================================================
-- NULL EXACTLY WHEN IT IS AN INSURANCE COMPANY — a CHECK, not a convention
-- ============================================================================================
-- "Broker kind" is meaningless for an insurer. The column is therefore nullable, which on its own
-- would permit both wrong shapes: an insurance company carrying CORPORATE (a value nothing reads,
-- and a lie), and a brokerage office carrying NULL (the state item (e)'s rule could not evaluate).
-- `Organization_broker_kind_matches_type` refuses both, in both directions.
--
-- Prisma cannot express a CHECK constraint, so `db:divergence` is structurally blind to this one —
-- a measured blind spot of that gate, alongside partial indexes. The assertions at the bottom are
-- therefore the only thing standing between this constraint and a future migration dropping it
-- silently.
--
-- ============================================================================================
-- THE BACKFILL IS CORPORATE, AND IT IS AN ASSUMPTION RATHER THAN A MEASUREMENT
-- ============================================================================================
-- Stated plainly because nobody can re-derive it later. The CHECK requires a value for every
-- existing brokerage office, so one had to be chosen, and CORPORATE is chosen on two grounds:
--
--   1. It is what the existing rows ARE. Both offices on dev are named as companies ("Default
--      Brokerage Office", "Rawabi Insurance Brokerage (demo)"), and db-test's single office is a
--      test fixture. None is a real sole establishment.
--   2. It is the NON-RESTRICTING value. A corporate broker may hold both insurance types, so this
--      backfill cannot retroactively invalidate a licence scope that already exists. Backfilling
--      NATURAL_PERSON would have asserted a one-type limit about offices nobody has asked.
--
-- The direction of the residual risk is worth naming: if a real office IS a sole establishment and
-- is recorded CORPORATE, item (e)'s one-type refusal will not fire for it. That is a question for
-- the office to answer on its own record, not something this migration can measure — and it is why
-- the kind is NOT NULL for a brokerage rather than defaulted, so a NEW office must state it.

CREATE TYPE "BrokerKind" AS ENUM ('NATURAL_PERSON', 'CORPORATE');

ALTER TABLE "Organization" ADD COLUMN "brokerKind" "BrokerKind";

-- See the header. Scoped to brokerage offices, which today is every row — written as a filtered
-- UPDATE anyway, so re-running it after an insurance company exists cannot give one a broker kind.
UPDATE "Organization"
   SET "brokerKind" = 'CORPORATE'
 WHERE "type" = 'BROKERAGE_OFFICE' AND "brokerKind" IS NULL;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_broker_kind_matches_type"
  CHECK (
    ("type" = 'BROKERAGE_OFFICE' AND "brokerKind" IS NOT NULL)
    OR ("type" <> 'BROKERAGE_OFFICE' AND "brokerKind" IS NULL)
  );

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  label_set   TEXT;
  def         TEXT;
  bad_rows    BIGINT;
  total_rows  BIGINT;
BEGIN
  -- 1. Exactly the two kinds art. 3/a names.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    INTO label_set
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'BrokerKind';
  IF label_set IS DISTINCT FROM 'NATURAL_PERSON,CORPORATE' THEN
    RAISE EXCEPTION 'broker kind: expected exactly NATURAL_PERSON,CORPORATE — found %', label_set;
  END IF;

  -- 2. The constraint exists AND its predicate still names BOTH columns.
  --
  --    Checking only that a constraint with this NAME exists is not enough, and the reason is
  --    recorded in migration 20261028100000: a predicate loosened to `TRUE OR (...)` satisfies a
  --    name check and refuses nothing. So the definition itself is read back and both column names
  --    are required to appear in it.
  SELECT pg_get_constraintdef(c.oid)
    INTO def
    FROM pg_constraint c
   WHERE c.conrelid = '"Organization"'::regclass
     AND c.conname  = 'Organization_broker_kind_matches_type';
  IF def IS NULL THEN
    RAISE EXCEPTION 'broker kind: the CHECK constraint Organization_broker_kind_matches_type does not exist';
  END IF;
  IF position('brokerKind' IN def) = 0 OR position('type' IN def) = 0 THEN
    RAISE EXCEPTION 'broker kind: the CHECK no longer names both columns — it reads %', def;
  END IF;

  -- 3. No row is in either wrong shape. Belt-and-braces behind the CHECK, which would itself have
  --    refused to be created over violating data — so this is what turns "the constraint was
  --    added" into "the constraint was added AND the table satisfies it", which are the same thing
  --    today and would not be if the predicate were ever weakened.
  SELECT count(*),
         count(*) FILTER (
           WHERE ("type" = 'BROKERAGE_OFFICE' AND "brokerKind" IS NULL)
              OR ("type" <> 'BROKERAGE_OFFICE' AND "brokerKind" IS NOT NULL))
    INTO total_rows, bad_rows
    FROM "Organization";
  IF bad_rows <> 0 THEN
    RAISE EXCEPTION 'broker kind: % row(s) have a kind that does not match their organization type', bad_rows;
  END IF;

  RAISE NOTICE 'broker kind: % organization(s) checked; brokerage offices backfilled CORPORATE (an assumption — see this migration''s header).', total_rows;
END $$;
