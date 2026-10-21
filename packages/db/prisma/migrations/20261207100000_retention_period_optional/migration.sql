-- MODULE 0-ب, THE CATEGORIES — `RetentionScheduleItem.retentionPeriodMonths` becomes NULLABLE.
--
-- ## WHY, AND IT IS THE OWNER'S DECISION RATHER THAN A SCHEMA PREFERENCE
--
-- Decisions 32 and 33. The product now SHIPS a retention template, and a category governed by one
-- of the two statutory floors ships with NO PERIOD — the screen shows the ARTICLE and the FLOOR
-- beside an empty field, and the office fills it in above the floor on its own lawyer's advice.
--
-- Her reason is the whole of it: **a period shipped beside an article number reads as a legal
-- opinion from us, and we do not have one.** A category with no floor ships with a DEFAULT, because
-- there a number is a convenience and claims nothing about any statute.
--
-- So "no period yet" has to be representable. It was not: the column was `Int` NOT NULL, which left
-- only two ways to ship a floored category — invent a number (the thing being refused) or ship the
-- category with the floor's own minimum, which asserts that the minimum IS the office's period and
-- is the same claim one step quieter.
--
-- ## NULL IS A STATE, NOT AN ABSENCE OF DATA, AND IT IS INERT
--
-- A row with no period is never measured and never alerted on. That is NOT a new flag — the brief
-- forbids one and `confirmedByLegalCounselAt` already carries the sibling condition. Both are read
-- through ONE predicate, `periodIsActionable()`, by the notice and by the disposal nomination, so
-- the two surfaces cannot disagree about what a draft is.
--
-- `disposal-batch.service.ts` has refused an UNCONFIRMED period since batch 5 group 5. The NOTICE
-- did not — which, the moment a template shipped, would have alerted an office about records
-- measured against a period nobody had set or signed.
--
-- ## NO DEFAULT, AND THAT IS DELIBERATE
--
-- `Organization.type` set the precedent and the argument is the same here: where neither value is
-- stricter, a default only decides, silently, the thing a caller forgot to state. Here it is worse
-- than silent — a `DEFAULT 0` would make an unset period read as "destroy immediately".
--
-- ## WHAT THIS DOES NOT DO
--
-- It adds NO category and NO floor. The template is seeded (`ensureRetentionTemplate`, a SWEEP over
-- every brokerage office, never a named id — the recorded rule), and every floored row takes its
-- floor by LOOKUP from `retention-floors.config.ts`. The fourteen unsourced category names from
-- group 5 stay unsourced: a floor added on an engineer's reading is this product telling a broker
-- the law says something it does not.

ALTER TABLE "RetentionScheduleItem" ALTER COLUMN "retentionPeriodMonths" DROP NOT NULL;

DO $$
DECLARE
  is_nullable BOOLEAN;
  has_default BOOLEAN;
  null_rows INT;
BEGIN
  SELECT a.attnotnull = false INTO is_nullable
  FROM pg_attribute a
  WHERE a.attrelid = 'public."RetentionScheduleItem"'::regclass
    AND a.attname = 'retentionPeriodMonths'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF is_nullable IS NULL THEN
    RAISE EXCEPTION 'the retentionPeriodMonths column is missing';
  END IF;
  IF NOT is_nullable THEN
    RAISE EXCEPTION 'the column is still NOT NULL — the DROP NOT NULL did not take, so a floored category cannot ship without a period';
  END IF;

  -- NO DEFAULT. A `DEFAULT 0` would make an unset period mean "destroy immediately", which is the
  -- worst available reading of a column whose whole purpose is to be empty until a lawyer fills it.
  SELECT EXISTS (
    SELECT 1 FROM pg_attrdef d
    WHERE d.adrelid = 'public."RetentionScheduleItem"'::regclass
      AND d.adnum = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public."RetentionScheduleItem"'::regclass
          AND attname = 'retentionPeriodMonths'
      )
  ) INTO has_default;
  IF has_default THEN
    RAISE EXCEPTION 'the column carries a DEFAULT — an unset period would silently mean a number nobody chose';
  END IF;

  -- NOTHING IS BACKFILLED TO NULL. Every existing row keeps the period its office set; this
  -- migration widens what is representable and changes no data. Asserted as a count rather than
  -- argued, because a migration that quietly emptied a confirmed retention period would be
  -- destroying a compliance decision.
  SELECT count(*) INTO null_rows
  FROM "RetentionScheduleItem" WHERE "retentionPeriodMonths" IS NULL;
  IF null_rows <> 0 THEN
    RAISE EXCEPTION 'this migration emptied % existing period(s) — it must change no data', null_rows;
  END IF;

  RAISE NOTICE 'retentionPeriodMonths is nullable with no default; % existing row(s) kept their period', (SELECT count(*) FROM "RetentionScheduleItem");
END $$;
