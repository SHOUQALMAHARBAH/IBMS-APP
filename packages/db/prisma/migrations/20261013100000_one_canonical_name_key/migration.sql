-- Insurer management — ONE canonical name key, living in the database.
--
-- ============================================================================
-- THE DEFECT THIS CLOSES (F13), WHICH WAS ALREADY LIVE
-- ============================================================================
--
-- Two places decided whether two spellings are one company, and they disagreed:
--
--   * the insurer DIRECTORY grouped by "Insurer"."canonicalName" — the full folding:
--     alef forms, diacritics, tatweel, ة/ه, ى/ي, the definite article, punctuation and
--     WORD ORDER;
--   * REGISTRATION refused a duplicate on lower("legalName") — case only.
--
-- Measured before this migration, on db-test, with the application's own function:
-- registering "Al-Yarmouk Insurance" and "al yarmouk   insurance" into ONE office was
-- ACCEPTED as two rows, and the directory presented them as ONE entry. Two insurer
-- records, two sets of credit terms, two panels — one line on the screen, and no error
-- anywhere. A read surface that did not agree with the write path feeding it.
--
-- ============================================================================
-- THE SHAPE: the database owns the key
-- ============================================================================
--
-- 1. `canonical_name_key(text)` — an IMMUTABLE function. The single definition.
-- 2. "Insurer"."canonicalName" becomes a STORED GENERATED column over it, so the
--    application cannot write it at all, correctly or otherwise. Postgres requires the
--    expression to be immutable, which is why (1) is IMMUTABLE rather than merely marked so.
-- 3. The directory view groups by that column; the partial unique index is rebuilt on it.
--    ONE key, TWO consumers — not a TypeScript function and a SQL expression kept in step
--    by careful people.
--
-- The TypeScript `canonicalNameKey()` survives for ONE job: suggesting "did you mean …?"
-- mid-registration, before a row exists to generate a key from. It is pinned to this
-- function by `canonical-name-key-parity.e2e-spec.ts`, a table of 39 names asserted against
-- both, so divergence is a failing build.
--
-- Generated from "legalName" ALONE, deliberately. A generated column cannot read another
-- table, and it does not need to: a catalogue-linked row groups by `insurerMasterId` and is
-- excluded from the unique index by its WHERE clause, so the key is only ever needed for a
-- locally registered row — where `legalName` is the name, and the `Insurer_has_identity`
-- CHECK guarantees it is not null.
--
-- Pre-checked rather than hoped: 0 colliding groups under the new key on both databases,
-- so no existing row is refused by the rebuilt index.

-- ---------------------------------------------------------------------------
-- 1. The one definition.
-- ---------------------------------------------------------------------------
-- STRICT so a NULL name yields a NULL key (a catalogue-linked row has no local name).
-- PARALLEL SAFE because it touches nothing outside its argument.
--
-- `COLLATE "C"` on the token sort is load-bearing and CANNOT be proven behaviourally on
-- this test image: `postgres:18-alpine` is musl, which ships no locale data, so the
-- database's `en_US.utf8` already falls back to byte order. On a glibc or ICU deployment
-- `en_US.utf8` is dictionary order — 'étoile' would sort beside 'etoile' instead of after
-- 'zurich' — and the key would silently differ from the suggestion for any name carrying a
-- Latin accent. The parity spec therefore asserts the clause's presence in the source, and
-- says why it cannot assert the behaviour.
CREATE OR REPLACE FUNCTION canonical_name_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $fn$
  SELECT coalesce(
    array_to_string(
      ARRAY(
        SELECT stripped
        FROM (
          -- The Arabic definite article, but only where three more Arabic letters follow,
          -- so a genuinely short word is not beheaded.
          SELECT regexp_replace(tok, '^ال(?=[؀-ۿ]{3,})', '') AS stripped
          FROM regexp_split_to_table(
                 -- Punctuation becomes a separator: "Motor (Comprehensive)" and
                 -- "Motor — Comprehensive" are one name.
                 regexp_replace(
                   -- Alef variants -> ا, alef maqsura -> ي, teh marbuta -> ه.
                   translate(
                     -- Diacritics and tatweel carry no meaning in a name.
                     regexp_replace(lower(value), '[ً-ْٰـ]', '', 'g'),
                     'آأإٱىة',
                     'اااايه'
                   ),
                   '[^[:alnum:][:space:]]', ' ', 'g'
                 ),
                 '\s+'
               ) AS tok
          WHERE tok <> ''
        ) t
        WHERE stripped <> ''
        -- Word order varies without changing the name, so the tokens are SORTED.
        ORDER BY stripped COLLATE "C"
      ),
      ' '
    ),
    ''
  )
$fn$;

COMMENT ON FUNCTION canonical_name_key(text) IS
  'The single definition of "are these two names the same name". Backs the GENERATED column Insurer.canonicalName, the insurer directory''s GROUP BY, and the per-office uniqueness of a locally registered company. Mirrored in TypeScript for registration suggestions only, pinned by canonical-name-key-parity.e2e-spec.ts. Folds orthography, the Arabic definite article, punctuation and word order; it does NOT fold meaning — synonyms are a similarity layer on top, never a replacement.';

-- ---------------------------------------------------------------------------
-- 2. The view depends on the column, so it goes first and comes back last.
-- ---------------------------------------------------------------------------
DROP VIEW "InsurerDirectory";

-- Postgres cannot convert an existing column into a STORED generated one, so the column is
-- replaced. Dropping it takes its index with it; both are recreated below. No data is lost
-- that is not immediately recomputed: every value this column held was `canonical_name_key`
-- of the same row's name, written by the application it is now taken away from.
ALTER TABLE "Insurer" DROP COLUMN "canonicalName";
ALTER TABLE "Insurer"
  ADD COLUMN "canonicalName" TEXT
  GENERATED ALWAYS AS (canonical_name_key("legalName")) STORED;
CREATE INDEX "Insurer_canonicalName_idx" ON "Insurer" ("canonicalName");

-- ---------------------------------------------------------------------------
-- 3. Registration now refuses what the directory merges.
-- ---------------------------------------------------------------------------
-- RENAMED as well as rebuilt, and the name is the point: this no longer enforces "one local
-- NAME per office" but "one local COMPANY per office, whatever the spelling". The unique-index
-- inventory test in `insurer-schema-constraints.e2e-spec.ts` fails on the change, which is the
-- guard working — `InsurerService.asCollision`'s per-write-path reasoning was re-derived
-- against the new index rather than the expectation being updated.
DROP INDEX "Insurer_one_local_name_per_org";
CREATE UNIQUE INDEX "Insurer_one_local_company_per_org"
  ON "Insurer" ("organizationId", "canonicalName")
  WHERE "insurerMasterId" IS NULL;

-- NULL-distinctness is not a hazard here, unlike on a nullable variant column: the partial
-- index covers only rows with no catalogue link, and `Insurer_has_identity` guarantees such a
-- row carries a `legalName`, so the generated key is never NULL inside the index's scope.

-- ---------------------------------------------------------------------------
-- 4. The view, unchanged in meaning — it already read `canonicalName`.
-- ---------------------------------------------------------------------------
CREATE VIEW "InsurerDirectory" WITH (security_invoker = false) AS
WITH keyed AS (
  SELECT
    i."id",
    i."createdAt",
    COALESCE(i."insurerMasterId", i."canonicalName", 'unkeyed:' || i."id")
      AS "directoryKey",
    COALESCE(im."legalName", i."legalName") AS "name",
    COALESCE(im."legalNameAr", i."legalNameAr") AS "nameAr",
    i."structure",
    i."companyPhone",
    i."companyEmail",
    i."companyWebsite",
    i."companyCorrespondenceAddress"
  FROM "Insurer" i
  LEFT JOIN "InsurerMaster" im ON im."id" = i."insurerMasterId"
),
company_lines AS (
  SELECT
    k."directoryKey",
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'code', sl."code",
        'nameEn', COALESCE(sl."nameEn", ol."nameEn"),
        'nameAr', COALESCE(sl."nameAr", ol."nameAr")
      )
    ) AS "lines"
  FROM keyed k
  JOIN "InsurerOfferedLine" o ON o."insurerId" = k."id"
  LEFT JOIN "InsuranceLine" sl ON sl."id" = o."insuranceLineId"
  LEFT JOIN "OfficeInsuranceLine" ol ON ol."id" = o."officeInsuranceLineId"
  GROUP BY k."directoryKey"
)
SELECT
  k."directoryKey",
  (array_remove(array_agg(k."name" ORDER BY k."createdAt"), NULL))[1] AS "name",
  (array_remove(array_agg(k."nameAr" ORDER BY k."createdAt"), NULL))[1] AS "nameAr",
  (array_remove(array_agg(k."structure" ORDER BY k."createdAt"), NULL))[1]
    AS "structure",
  (array_remove(array_agg(k."companyPhone" ORDER BY k."createdAt"), NULL))[1]
    AS "companyPhone",
  (array_remove(array_agg(k."companyEmail" ORDER BY k."createdAt"), NULL))[1]
    AS "companyEmail",
  (array_remove(array_agg(k."companyWebsite" ORDER BY k."createdAt"), NULL))[1]
    AS "companyWebsite",
  (
    array_remove(
      array_agg(k."companyCorrespondenceAddress" ORDER BY k."createdAt"), NULL
    )
  )[1] AS "companyCorrespondenceAddress",
  COALESCE(cl."lines", '[]'::jsonb) AS "lines"
FROM keyed k
LEFT JOIN company_lines cl ON cl."directoryKey" = k."directoryKey"
GROUP BY k."directoryKey", cl."lines";

GRANT SELECT ON "InsurerDirectory" TO ibms_app;
REVOKE INSERT, UPDATE, DELETE ON "InsurerDirectory" FROM ibms_app;
