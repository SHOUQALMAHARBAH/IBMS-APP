-- `RiskProfile.siteLabel` becomes NOT NULL.
--
-- WHY: the column was nullable by OMISSION, not by design. Item 5 batch 2 measured 767 rows across dev
-- and db-test with ZERO null or empty labels, so the screens' fallback — which printed a truncated uuid,
-- and whose `aria-label` printed the FULL uuid to a screen reader — had never rendered. Nothing else on
-- the row is a name a person recognises (`customerId` is a uuid, and the list is already scoped to one
-- customer), so there was no better substitute to pick.
--
-- Requiring it in the DTO alone would leave the SHAPE able to express the state, and a later writer could
-- reintroduce it. This makes it unrepresentable instead of handled.
--
-- SAFE BY MEASUREMENT, ASSERTED HERE RATHER THAN ASSUMED: the DO block below refuses the migration if any
-- row would violate the constraint, so this cannot silently fail on a database whose contents differ from
-- the two that were measured.

DO $$
DECLARE
  offending integer;
BEGIN
  SELECT count(*) INTO offending
  FROM "RiskProfile"
  WHERE "siteLabel" IS NULL OR btrim("siteLabel") = '';

  IF offending > 0 THEN
    RAISE EXCEPTION
      'RiskProfile.siteLabel cannot be made NOT NULL: % row(s) have no label. Give each one a site name first — the value is what identifies the profile to a person, so it cannot be backfilled with a placeholder.',
      offending;
  END IF;
END $$;

ALTER TABLE "RiskProfile" ALTER COLUMN "siteLabel" SET NOT NULL;

-- And the constraint is asserted from the database's own catalogue, not from the statement above having
-- run: `db:divergence` does not see every kind of change, and a migration that claims a property should
-- prove it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'RiskProfile' AND column_name = 'siteLabel' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'RiskProfile.siteLabel is still nullable after this migration';
  END IF;
END $$;
