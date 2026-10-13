-- MODULE 0-ب PART E MEASUREMENT 3 — `Organization.legalNameAr` becomes NOT NULL.
--
-- ============================================================================================
-- THE MEASUREMENT DECIDED THIS, NOT A PREFERENCE
-- ============================================================================================
-- The owner's instruction: "The count of organization rows with no Arabic legal name, on both
-- databases. Zero tightens the column to NOT NULL; non-zero keeps it nullable, enforces it at
-- registration, and is recorded as a named data-quality finding with its number."
--
-- Measured before writing this, on both:
--
--   dev      0 of 3 organizations have no Arabic legal name
--   db-test  0 of 2 organizations have no Arabic legal name
--
-- Zero. So the column tightens, and the branch that would have kept it nullable and filed a
-- data-quality finding is not taken.
--
-- ============================================================================================
-- WHAT THIS REMOVES, AND WHY THE OLD REASON NO LONGER HOLDS
-- ============================================================================================
-- The column's own comment said it was "optional only because an office may be onboarded before
-- its registered Arabic name is confirmed". That was true while nothing could onboard an office at
-- all — there was no registration path, so the only organizations were seeded ones and the
-- nullability protected a case nobody could reach.
--
-- Module 0-ب gives the provider a registration form, and the field dictionary marks the Arabic
-- legal name MANDATORY on both sheets. An office onboarded without one would print untranslated
-- mid-sentence on every Arabic screen in a system whose base language is Arabic — and the moment
-- the form exists, "we will add the Arabic later" becomes a row somebody actually creates.
--
-- The DATABASE holds it rather than only the DTO, for the reason item (a) of module 0 recorded: a
-- type is absent from raw SQL, from a migration, and from anything reaching this table without the
-- generated client. The form will refuse it too; this is what makes the refusal unskippable.
--
-- ============================================================================================
-- NO BACKFILL, DELIBERATELY
-- ============================================================================================
-- There is nothing to backfill — that is the measurement above. A migration that invented an
-- Arabic name for a row that lacked one would be writing a legal name nobody can source, which is
-- the same defect class as stamping a CBJ approval date nobody entered. If a future database DOES
-- hold such a row, this migration FAILS LOUDLY on the `SET NOT NULL` rather than guessing, and the
-- assertion below explains what to do.

DO $$
DECLARE
  blanks INTEGER;
BEGIN
  -- Fail with the ACTIONABLE message before Postgres fails with a generic one. An operator hitting
  -- this needs to know it is their data, not the migration, and that nothing here will invent a
  -- name for them.
  SELECT count(*) INTO blanks FROM "Organization"
   WHERE "legalNameAr" IS NULL OR btrim("legalNameAr") = '';
  IF blanks > 0 THEN
    RAISE EXCEPTION USING MESSAGE = format(
      '%s organization(s) have no Arabic legal name, so this column cannot be made NOT NULL. '
      'Record the registered Arabic name for each of them and re-run. This migration will not '
      'invent one: a legal name nobody can source is worse than a missing field.', blanks);
  END IF;
END $$;

ALTER TABLE "Organization" ALTER COLUMN "legalNameAr" SET NOT NULL;

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n INTEGER;
BEGIN
  -- 1. The tightening took.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Organization"'::regclass AND attname = 'legalNameAr'
     AND attnotnull AND attnum > 0 AND NOT attisdropped;
  IF n <> 1 THEN
    RAISE EXCEPTION 'legalNameAr is still nullable — the SET NOT NULL did not take';
  END IF;

  -- 2. NO DEFAULT. A default here would be the invented name this migration refuses to write,
  --    arriving silently on every future row instead of once. `Organization.type` carries no
  --    default for the same reason: a column that decides a fact for a caller who forgot to state
  --    it is worse than a column that refuses.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Organization"'::regclass AND attname = 'legalNameAr' AND atthasdef;
  IF n <> 0 THEN
    RAISE EXCEPTION 'legalNameAr carries a DEFAULT — a default here is an invented legal name';
  END IF;

  -- 3. An empty string is NOT caught by NOT NULL, and that gap is named rather than left implicit.
  --    '' satisfies the constraint while being exactly as unprintable as NULL. The DTO refuses it
  --    (`@IsNotEmpty`), and this assertion records that the DATABASE does not — so nobody later
  --    reads NOT NULL as a guarantee that the name is present.
  SELECT count(*) INTO n FROM "Organization" WHERE btrim("legalNameAr") = '';
  IF n <> 0 THEN
    RAISE EXCEPTION '% organization(s) hold an EMPTY Arabic legal name — NOT NULL does not catch this', n;
  END IF;

  RAISE NOTICE 'legalNameAr is NOT NULL with no default; 0 blank values.';
END $$;
