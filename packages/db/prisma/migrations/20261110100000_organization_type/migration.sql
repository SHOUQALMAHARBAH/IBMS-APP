-- MODULE 0, ITEM (a): AN ORGANIZATION NOW SAYS WHAT KIND OF THING IT IS.
--
-- Created 2026-10-11. Until this migration every `Organization` row was a brokerage office and
-- nothing in the schema said so — "office" is used throughout the codebase as a plain synonym for
-- the tenant. An insurance company needs a row of its own, with its own registration field list
-- and its own agreement with the broker, so the kind has to be STATED rather than inferred from
-- the fact that nothing else existed.
--
-- ============================================================================================
-- NO DEFAULT, DELIBERATELY — AND THIS IS THE OPPOSITE CALL FROM `dutySegregationMode`
-- ============================================================================================
-- That column (migration 20261028100000) has `DEFAULT 'SEGREGATED'` and was right to: SEGREGATED
-- is the STRICTER of its two values, so every existing office read the safe one and nothing
-- changed for anybody.
--
-- There is no stricter value here. A brokerage office and an insurance company are two different
-- legal entities under different CBJ licensing; neither is a safe fallback for the other. A
-- default would therefore not protect anything — it would only decide, silently, the kind that a
-- caller forgot to name, and the first symptom would be an insurance company holding a broker
-- licence number.
--
-- So: added NULLABLE, backfilled, then SET NOT NULL, with no default left behind. The seven
-- `organization.create` call sites (the seed, the demo script and five e2e specs — measured, not
-- estimated) each state the kind. There is no application route that creates an Organization at
-- all, which is what makes requiring it cheap.
--
-- ============================================================================================
-- TENANT ISOLATION IS UNCHANGED, and that is a property worth asserting rather than asserting
-- ============================================================================================
-- `tenantScopeExtension` derives `TENANT_SCOPED_MODELS` from the DMMF as "every model carrying an
-- organizationId". `Organization` does not carry one — it IS the tenant — so it has never been in
-- that set and adding a column to it cannot put it there. No RLS policy is added, altered or
-- needed here, and the 130-of-130 RLS coverage figure does not move.

CREATE TYPE "OrganizationType" AS ENUM ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');

ALTER TABLE "Organization" ADD COLUMN "type" "OrganizationType";

-- Every row that exists today is a brokerage office. There is no other kind yet, by construction:
-- this migration is what makes another kind representable.
UPDATE "Organization" SET "type" = 'BROKERAGE_OFFICE' WHERE "type" IS NULL;

ALTER TABLE "Organization" ALTER COLUMN "type" SET NOT NULL;

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
-- Read from the catalogue rather than from what this migration believes it just did, which is the
-- lesson of `20261103100000`: an assertion whose answer depends on which database it runs against
-- is not an assertion. All four of these are environment-independent.
DO $$
DECLARE
  label_set      TEXT;
  is_not_null    BOOLEAN;
  has_default    BOOLEAN;
  null_rows      BIGINT;
  non_brokerage  BIGINT;
  total_rows     BIGINT;
BEGIN
  -- 1. The enum carries exactly the two intended labels, in order. A third label added here later
  --    without a decision is a new kind of organization nobody chose.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    INTO label_set
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'OrganizationType';
  IF label_set IS DISTINCT FROM 'BROKERAGE_OFFICE,INSURANCE_COMPANY' THEN
    RAISE EXCEPTION 'organization type: expected exactly BROKERAGE_OFFICE,INSURANCE_COMPANY — found %', label_set;
  END IF;

  -- 2. NOT NULL actually took, and 3. no default was left behind. The second is the one that could
  --    rot silently: a default would make every future omission invisible instead of a loud error.
  SELECT a.attnotnull, a.atthasdef
    INTO is_not_null, has_default
    FROM pg_attribute a
   WHERE a.attrelid = '"Organization"'::regclass
     AND a.attname  = 'type'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT is_not_null THEN
    RAISE EXCEPTION 'organization type: column is nullable; the SET NOT NULL did not take';
  END IF;
  IF has_default THEN
    RAISE EXCEPTION 'organization type: column carries a DEFAULT — see this migration''s header for why it must not';
  END IF;

  -- 4. The backfill reached EVERY row, and reached it with the right value. Counted and reported,
  --    because "0 rows converted" and "all rows converted" are both clean-looking and only one of
  --    them is correct on a populated database.
  --
  --    `null_rows` is DEFENSIVE AND CURRENTLY UNREACHABLE — said plainly rather than counted as a
  --    proof. If the backfill above missed a row, the `SET NOT NULL` would have failed before this
  --    block ran; and planting a NULL requires first dropping NOT NULL, which check 2 catches one
  --    step earlier. It is kept for the edit that reorders those statements, not because it has
  --    ever been observed firing. `non_brokerage` below IS independently observed.
  SELECT count(*),
         count(*) FILTER (WHERE "type" IS NULL),
         count(*) FILTER (WHERE "type" <> 'BROKERAGE_OFFICE')
    INTO total_rows, null_rows, non_brokerage
    FROM "Organization";
  IF null_rows <> 0 THEN
    RAISE EXCEPTION 'organization type: % row(s) are still NULL after the backfill', null_rows;
  END IF;
  IF non_brokerage <> 0 THEN
    RAISE EXCEPTION 'organization type: % row(s) are not BROKERAGE_OFFICE, which this migration cannot have produced', non_brokerage;
  END IF;

  RAISE NOTICE 'organization type: % organization(s) backfilled as BROKERAGE_OFFICE; column NOT NULL with no default.', total_rows;
END $$;
