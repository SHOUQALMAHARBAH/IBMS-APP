-- Insurer management — the cross-office DIRECTORY.
--
-- A read-only list of the insurance companies any office has registered, visible to
-- every office, so an office looking for who writes a line does not have to discover
-- the market by asking around. Fed automatically by what offices register; it is not a
-- vendor-curated catalogue and nothing maintains it by hand.
--
-- ============================================================================
-- THE BOUNDARY, AND WHY IT IS A VIEW RATHER THAN A QUERY
-- ============================================================================
--
-- These are COMPETING BROKERAGES on one platform. The company is public knowledge; the
-- panel is not. So the directory shows the company — legal name in both scripts, its
-- structure, general contact details, lines of business offered — and must NEVER show
-- which offices deal with it, nor anything from the office-scoped relationship: no
-- credit terms, no financial-strength rating, no commission, no relationship contacts,
-- no count of offices, no registration dates.
--
-- That could have been a filtered query in the application. It is a SECURITY DEFINER
-- view instead, because the two failure modes are not comparable:
--
--   * A filtered query needs a `select` clause to stay correct forever. Someone adds a
--     column to a shared select — as has already happened twice in this codebase — and
--     a credit term crosses an office boundary with every test still green.
--   * A view has no relationship columns to leak. The app role still cannot read another
--     office's `Insurer` row AT ALL (RLS), and the one thing it can read does not
--     contain the data. The boundary is a property of the schema, not of a code path.
--
-- `security_invoker = false` (the default, stated explicitly because it is the whole
-- mechanism): the view executes with its OWNER's privileges, and the owner is the table
-- owner, who is not subject to the RLS policy on `Insurer`. So this view — and only this
-- view — sees every office's rows, and it discards everything office-specific before
-- returning anything.
--
-- It is also NOT WRITABLE, structurally: an aggregating view with a GROUP BY is not
-- auto-updatable in Postgres, so the INSERT/UPDATE/DELETE that default privileges grant
-- on new relations cannot be used against it. The grant below is SELECT only anyway.
--
-- ============================================================================
-- AGGREGATION RULES
-- ============================================================================
--
--   GROUP BY      `insurerMasterId`, else the stored `canonicalName`, else the row's own
--                 id. A catalogue-linked row groups by the company it links to, which
--                 makes every pre-existing row merge correctly with no backfill. A
--                 locally registered row groups by its canonical name, which is what
--                 makes two offices registering the same company one directory entry.
--                 A row with neither — registered before `canonicalName` existed — is
--                 its own entry, because merging it would need the folding rules
--                 rewritten in SQL and a near-miss there is worse than an extra row.
--   NAMES/CONTACT first non-null, earliest registration first. Somebody had to type it;
--                 the office that got there first is as good an authority as any, and
--                 "first non-null" means a later office filling in a blank still helps.
--   LINES         the UNION across offices, deduplicated. A line a company writes is a
--                 fact about the company. Standard lines carry their code; a line an
--                 office added itself appears by name with a null code and no hint of
--                 which office added it.
--   PRESENCE      depends only on having been REGISTERED. There is no filter on
--                 `isActive` anywhere below, deliberately: a company vanishing from the
--                 directory the moment the last office stopped dealing with it would be
--                 a weakened form of exactly the disclosure this boundary forbids — a
--                 disappearance is a signal about other offices' behaviour.

ALTER TABLE "Insurer" ADD COLUMN "canonicalName" TEXT;
-- Not unique: two offices registering the same company SHOULD store the same key. That
-- collision is what merges them into one directory entry.
CREATE INDEX "Insurer_canonicalName_idx" ON "Insurer" ("canonicalName");

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

-- SELECT only. The app role reads the directory and can do nothing else with it.
GRANT SELECT ON "InsurerDirectory" TO ibms_app;
-- And explicitly nothing else, in case default privileges on new relations ever change:
-- an aggregating view is not auto-updatable, so this is belt and braces on a property
-- Postgres already enforces.
REVOKE INSERT, UPDATE, DELETE ON "InsurerDirectory" FROM ibms_app;
