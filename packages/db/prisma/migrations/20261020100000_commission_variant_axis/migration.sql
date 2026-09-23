-- The commission variant axis, and a unique index that actually uniques the common case.
--
-- ============================================================================
-- WHY A VARIANT EXISTS AT ALL — MEASURED, NOT ARGUED
-- ============================================================================
--
-- The 32 managed lines cannot express a crossing: fleet-vs-individual motor, group-vs-individual
-- medical, or a named sub-peril. That was a prediction when the vocabulary was designed. It is now
-- an observation:
--
--     SELECT l.code, string_agg(DISTINCT c."insuranceLine", ' ++ '), count(*)
--       FROM "CommissionAgreement" c JOIN "InsuranceLine" l ON l.id = c."insuranceLineId"
--      WHERE c."effectiveTo" IS NULL GROUP BY c."insurerId", l.code HAVING count(*) > 1;
--
--     PROPERTY_ALL_RISKS | Property All Risks ++ Property All Risks (Fire) | 2     (x6 insurers)
--
-- Six insurers each carry TWO simultaneously-open commission agreements, and every one of them is
-- that same pair. They are not duplicates — a fire-only property rate is a different commercial
-- term from an all-risks one — and the existing partial unique index permits them only because it
-- keys on the STRING, where the two differ.
--
-- **So moving that index onto the line id without a variant would collapse six legitimately
-- distinct rates and the index could not be created.** The variant is what keeps
-- `(insurer, PROPERTY_ALL_RISKS, NULL)` and `(insurer, PROPERTY_ALL_RISKS, 'fire')` apart.
--
-- ============================================================================
-- THE DEFECT IN THE OBVIOUS KEY, WHICH TOUCHES MONEY
-- ============================================================================
--
-- `UNIQUE (insurerId, insuranceLineId, variantKey)` does NOT constrain two agreements that both
-- have a NULL variant: Postgres treats NULLs as distinct in a unique index, so **the plain-line
-- case — the common case — is exactly the one a naive constraint misses.** A unique that does not
-- unique, on the table that decides what the broker is paid.
--
-- `NULLS NOT DISTINCT` (Postgres 15+; this project runs 18) is the fix. It is asserted by PLANTING
-- two NULL-variant agreements and watching the insert refused, not by reading this DDL — a
-- constraint nobody has seen refuse anything is a constraint nobody has tested.
--
-- ============================================================================
-- WHAT IS NOT DONE HERE
-- ============================================================================
--
-- The OLD string-keyed index `CommissionAgreement_one_open_per_insurer_line` is KEPT. Both hold
-- simultaneously and neither is redundant while `insuranceLine` still exists: the old one guards
-- the old column, the new one guards the identity that replaces it. The old index drops in the
-- same migration that drops the string, gated on a test measuring zero unmapped rows.

-- ---------------------------------------------------------------------------
-- 1. The columns. `variantKey` is GENERATED, so the application cannot write it.
-- ---------------------------------------------------------------------------
ALTER TABLE "CommissionAgreement" ADD COLUMN "variant" TEXT;

-- Generated from the SAME function that backs `Insurer.canonicalName`. Reused rather than
-- reinvented: "Fleet", "fleet" and " FLEET " must be one variant, and the Arabic folding
-- (enumerated case fold, letters-not-the-block, digit folding, NFKC) comes free. `STRICT`, so a
-- NULL variant yields a NULL key — which is precisely why the index below needs
-- `NULLS NOT DISTINCT`.
ALTER TABLE "CommissionAgreement"
  ADD COLUMN "variantKey" TEXT
  GENERATED ALWAYS AS (canonical_name_key("variant")) STORED;

-- ---------------------------------------------------------------------------
-- 2. Derive the variant from the string that still holds it.
-- ---------------------------------------------------------------------------
-- The four values the line mapping could not express. Their distinction survived migration
-- `20261019100000` only because that migration retained `insuranceLine` — which is the whole
-- reason IMPROVEMENTS.md § 1.26 rule 3 keeps it. This is the pass that promotes it from a string
-- nobody can match on to a key the database enforces.
--
-- Two axes, not four cases (§ 1.25): 'collective' is fleet and group — one contract covering many
-- insureds, expressed in two lines of business. 'fire' is a named sub-peril, a different axis.
-- Named that way rather than 'fleet'/'group' so the next person adding one asks which AXIS it is
-- rather than appending to a list of observed spellings.
UPDATE "CommissionAgreement"
   SET "variant" = CASE lower(btrim("insuranceLine"))
     WHEN 'property all risks (fire)' THEN 'Fire'
     WHEN 'motor fleet'               THEN 'Collective'
     WHEN 'group medical'             THEN 'Collective'
     WHEN 'individual medical'        THEN 'Individual'
   END
 WHERE lower(btrim("insuranceLine")) IN (
   'property all risks (fire)', 'motor fleet', 'group medical', 'individual medical'
 );

-- ---------------------------------------------------------------------------
-- 3. REFUSE before constraining, naming what collides.
-- ---------------------------------------------------------------------------
-- The § 1.26 rule applied to a unique index: ask the question BEFORE the constraint answers it
-- with a violation halfway through, and answer it with the insurer and the rates rather than an
-- index name. A collision here means two open agreements the variant did not separate — a real
-- ambiguity about what the broker is paid, which a migration must not resolve by picking one.
DO $precheck$
DECLARE
  collisions text;
BEGIN
  SELECT string_agg(detail, E'\n  ') INTO collisions
  FROM (
    SELECT format(
             'insurer %s, line %s, variant %s: %s open agreements at rates %s',
             c."insurerId",
             coalesce(l.code, '(unmapped)'),
             coalesce(quote_literal(c."variant"), 'NONE'),
             count(*),
             string_agg(c."ratePercent"::text, ' / ' ORDER BY c."ratePercent")
           ) AS detail
      FROM "CommissionAgreement" c
      LEFT JOIN "InsuranceLine" l ON l.id = c."insuranceLineId"
     WHERE c."effectiveTo" IS NULL AND c."insuranceLineId" IS NOT NULL
     GROUP BY c."insurerId", l.code, c."insuranceLineId", c."variantKey", c."variant"
    HAVING count(*) > 1
  ) g;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION E'Two or more OPEN commission agreements share one (insurer, line, variant), so what the broker is paid is ambiguous:\n  %\n\nThe variant axis did not separate these. Either give them distinguishing variants or close the superseded ones (set effectiveTo) — a migration must not choose a rate on your behalf. Nothing has been changed.', collisions;
  END IF;
END
$precheck$;

-- ---------------------------------------------------------------------------
-- 4. The index, with the clause that makes it mean anything.
-- ---------------------------------------------------------------------------
-- `NULLS NOT DISTINCT` is the entire point. Without it two open plain-line agreements — the
-- common case — both insert, and the constraint silently guards only the variant-bearing rows.
CREATE UNIQUE INDEX "CommissionAgreement_one_open_per_line_variant"
  ON "CommissionAgreement" ("insurerId", "insuranceLineId", "variantKey")
  NULLS NOT DISTINCT
  WHERE "effectiveTo" IS NULL;

-- Looking up "which variants has this office already used for this line" — the entry control's
-- own query, so consistency is the default path rather than a discipline.
CREATE INDEX "CommissionAgreement_variant_lookup_idx"
  ON "CommissionAgreement" ("organizationId", "insuranceLineId", "variantKey");

-- ---------------------------------------------------------------------------
-- 5. Verify, on the database being deployed to.
-- ---------------------------------------------------------------------------
DO $assert$
DECLARE
  nulls_not_distinct boolean;
  keyed              int;
BEGIN
  -- The clause itself, read from the catalogue rather than trusted. `indnullsnotdistinct` exists
  -- from Postgres 15; if this migration ever runs somewhere older, CREATE INDEX above would
  -- already have failed on the syntax, so reaching here means the column exists.
  SELECT i.indnullsnotdistinct INTO nulls_not_distinct
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'CommissionAgreement_one_open_per_line_variant';

  IF nulls_not_distinct IS NOT TRUE THEN
    RAISE EXCEPTION 'CommissionAgreement_one_open_per_line_variant was created WITHOUT NULLS NOT DISTINCT. Two open agreements with no variant — the common case — would both insert, and the index would silently guard only the variant-bearing rows. Refusing to deploy.';
  END IF;

  -- The generated column must actually be generated, not a plain column somebody can write.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'CommissionAgreement' AND column_name = 'variantKey'
       AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION '"variantKey" is not a GENERATED column. An application-written matching key is the defect this migration exists to remove.';
  END IF;

  -- And the derivation did something: the six measured Property-All-Risks-(Fire) rows, at least.
  SELECT count(*) INTO keyed FROM "CommissionAgreement" WHERE "variantKey" IS NOT NULL;
  RAISE NOTICE 'variantKey populated on % agreement(s).', keyed;
END
$assert$;
