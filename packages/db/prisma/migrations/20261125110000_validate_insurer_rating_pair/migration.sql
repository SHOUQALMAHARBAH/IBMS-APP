-- MODULE 0-ب ITEM (e), CORRECTION — THE RATING/DATE RULE STOPS HAVING THREE STANDING EXCEPTIONS.
--
-- ## WHAT `NOT VALID` LEFT BEHIND, AND WHY IT IS NOT GOOD ENOUGH
--
-- `20261124110000` added `Insurer_rating_carries_its_date` as `NOT VALID`, because three seeded
-- SAMPLE insurers already carried a rating and the date column did not exist until that statement.
-- Two paths were refused there and both refusals were right: backfilling a date in a migration
-- invents an unsourceable fact, and clearing the ratings modifies rows in an item whose delivery
-- evidence is that it modifies none.
--
-- A FOURTH PATH was missed, and it is better than either. Those three rows are SAMPLE DATA whose
-- value says so in the value itself — "A (sample rating)", "A+ (sample rating)", "A- (sample rating)".
-- Giving a sample row a sample date invents NOTHING, because a sample rating is not a fact about any
-- real insurer. So the repair belongs in the SEED, which is where those rows came from, and not in a
-- migration — and no migration modifies a row either way.
--
-- Without this, we ship a declared rule with three permanent exceptions and whoever runs
-- `VALIDATE CONSTRAINT` in a year meets rows nobody remembers. That is the same family as a guard
-- that is only true because nothing ever scanned the old data.
--
-- ## THE ORDER THIS DEPENDS ON, STATED BECAUSE IT IS THE ONE FRAGILE THING HERE
--
-- `SampleInsurerSeed` now carries `financialStrengthRatingAsOf`, the create path writes the pair, and
-- the existing-row branch fills the date in where it is missing — scoped to that ONE field, so it
-- cannot become a general "refresh the sample insurers" path that overwrites what an office has since
-- recorded about a counterparty it genuinely uses.
--
-- On a FRESH database this migration runs before any `Insurer` row exists, so it validates trivially.
-- On a database that already holds the old sample rows it needs the seed to have run first — so
-- instead of failing with Postgres's own message about an unspecified row, it PRE-CHECKS and names
-- the fix.

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM "Insurer"
   WHERE ("financialStrengthRating" IS NULL) <> ("financialStrengthRatingAsOf" IS NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION
      '% Insurer row(s) carry half the rating pair, so the constraint cannot be validated. Run the seed first (npm run seed -w @ibms/db, or seed:test): it fills the as-of date on the sample insurers. Do NOT backfill a date by hand here — a date invented in a migration is an unsourceable fact, which is the thing this constraint exists to prevent.', n;
  END IF;
END $$;

ALTER TABLE "Insurer" VALIDATE CONSTRAINT "Insurer_rating_carries_its_date";

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  isvalid BOOLEAN;
BEGIN
  -- (1) The composite tenant foreign keys are all still there.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) THE CONSTRAINT IS NOW VALIDATED. `convalidated` is the whole point of this migration, and
  --     reading it is the only way to tell a validated constraint from a NOT VALID one — they are
  --     otherwise identical in `pg_get_constraintdef`.
  SELECT c.convalidated INTO isvalid FROM pg_constraint c
   WHERE c.conrelid = '"Insurer"'::regclass AND c.conname = 'Insurer_rating_carries_its_date';
  IF isvalid IS NOT TRUE THEN
    RAISE EXCEPTION 'Insurer_rating_carries_its_date is still NOT VALID — the rule would keep its standing exceptions';
  END IF;

  -- (3) AND IT HOLDS FOR EVERY ROW, said a second way. The validation above is Postgres's own scan;
  --     this is the same claim expressed as data, so a future ALTER that re-marks the constraint
  --     NOT VALID without anybody noticing still leaves a test that can fail.
  SELECT count(*) INTO n FROM "Insurer"
   WHERE ("financialStrengthRating" IS NULL) <> ("financialStrengthRatingAsOf" IS NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION '% Insurer row(s) still carry half the pair after VALIDATE — which should be impossible', n;
  END IF;

  RAISE NOTICE 'Insurer_rating_carries_its_date is VALIDATED and holds for every row';
END $$;
