-- MODULE 0, ITEM (j): THE PROVIDER DASHBOARD — a cross-office read of OFFICE STATE and nothing else.
--
-- Follows the `InsurerDirectory` precedent exactly (`20261012100000`), because the problem is the
-- same one: a reader who legitimately needs facts spanning every office, where every office's rows
-- are otherwise unreachable by RLS.
--
-- ============================================================================================
-- WHY A VIEW AND NOT A FILTERED QUERY — the precedent's own argument, unchanged
-- ============================================================================================
-- `security_invoker = false` (the default, stated explicitly because it IS the mechanism): the view
-- executes with its OWNER's privileges, and the owner is the table owner, whom Postgres exempts from
-- the RLS policies on the underlying tables. So this view — and only this view — sees every office's
-- rows, and it discards everything it must not disclose BEFORE returning anything.
--
-- The alternative is a filtered query with a `select` clause, and the two failure modes are not
-- comparable: a select clause has to stay correct forever, and somebody widening a shared select is
-- how a credit term crossed an office boundary in this codebase twice with every test still green.
-- A view has no columns to leak, because the columns that would leak are not in it.
--
-- NOT WRITABLE, structurally: an aggregating view with GROUP BY is not auto-updatable in Postgres,
-- so the INSERT/UPDATE/DELETE that default privileges grant on new relations cannot be used against
-- it. The grant below is SELECT only anyway, and the others are revoked.
--
-- ============================================================================================
-- WHAT IS IN IT, AND THE DISCLOSURE THIS CREATES — read this before adding a column
-- ============================================================================================
-- OFFICE STATE ONLY: identity, status, broker kind, the current licence's number / expiry / status /
-- renewal-request date, how many branches the licence covers and how many of those carry no business,
-- user counts, and the office's most recent sign-in ACTIVITY.
--
-- NO customer, policy, premium, commission or price data. NO personal data of any kind — and that is
-- a property of the column list rather than a filter:
--
--   * `lastActivityAt` is a MAX over the office's sessions. It is an OFFICE-level timestamp with no
--     `userId`, no name and no email. "When did anybody in this office last use the system" is a
--     fact about the office; "when did Ahmad last sign in" is a fact about Ahmad, and this view
--     cannot express it.
--   * the user counts are COUNTS. A count is not a person.
--
-- THE DISCLOSURE IS REAL AND IS NAMED HERE RATHER THAN DISCOVERED. Unlike the insurer directory —
-- which discloses facts about third-party INSURERS — this discloses facts about other BROKERAGE
-- OFFICES, who are each other's competitors. `dormantLicensedBranches` in particular tells a reader
-- that another office is licensed for a line and writes no business in it, which is commercially
-- meaningful.
--
-- What bounds it: the column list above, and the single permission code
-- `provider.office-state.read`, granted to ONE seeded role. This product has no platform-operator
-- concept — every user belongs to an Organization — so "only the provider may read this" is not
-- expressible today, and an office granted that code sees every office. That is stated in the
-- service, in the screen and in README § Known gaps, and it is the reason no column may be added
-- here without the same argument being made again.
--
-- ============================================================================================
-- THE LAPSE RULE IS NOT REIMPLEMENTED IN SQL, DELIBERATELY
-- ============================================================================================
-- The view returns the current term's `status`, `expiresAt` and `renewalRequestedAt` RAW, and the
-- service applies `isBrokerLicenseCurrentlyLapsed`. Copying that rule into SQL would be a second
-- home for a REGULATORY rule whose check order is load-bearing — manual lapse first, then inside
-- the term, then art. 11's by-operation-of-law extension (item (d)) — and the copy is the one that
-- drifts. A provider dashboard reporting an office as lapsed when the application says otherwise is
-- worse than no dashboard.
--
-- "The current term" is likewise the LATEST EXPIRY, matching `pickCurrentTerm`: between filing a
-- renewal and the old term running out an office legitimately holds two, and the newer one decides
-- whether it may practise.

CREATE VIEW "ProviderOfficeState" WITH (security_invoker = false) AS
WITH current_term AS (
  -- The LATEST EXPIRY per office, matching `pickCurrentTerm`. `DISTINCT ON` rather than a window
  -- function because it is the shortest honest spelling of "one row per office, the newest term".
  --
  -- The tie-break is the row ID, not a timestamp: `BrokerLicense` has NO `createdAt` column —
  -- measured the hard way, by the migration failing on `column bl.createdAt does not exist` — and a
  -- tie-break is still needed, because `@@unique([organizationId, licenseNumber, expiresAt])` admits
  -- two terms sharing an expiry. An arbitrary-but-STABLE answer beats one that changes between
  -- reads; `pickCurrentTerm` resolves the same tie the same way.
  SELECT DISTINCT ON (bl."organizationId")
    bl."organizationId",
    bl."id"                 AS "termId",
    bl."licenseNumber",
    bl."issuedAt",
    bl."expiresAt",
    bl."status"::text       AS "licenseStatus",
    bl."renewalRequestedAt"
  FROM "BrokerLicense" bl
  ORDER BY bl."organizationId", bl."expiresAt" DESC, bl."id" DESC
),
scope_counts AS (
  SELECT
    ct."organizationId",
    count(*)::int AS "licensedBranches",
    -- DORMANT: a branch the licence covers in which the office has placed no policy. Counted from
    -- the branch side with a NOT EXISTS, so an office with no policies at all reads as every branch
    -- dormant rather than as zero branches — which is the true answer and the one a provider cares
    -- about.
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1 FROM "Policy" p
         WHERE p."organizationId" = ct."organizationId"
           AND (
             (sl."insuranceLineId" IS NOT NULL AND p."insuranceLineId" = sl."insuranceLineId")
             OR (sl."officeInsuranceLineId" IS NOT NULL AND p."officeInsuranceLineId" = sl."officeInsuranceLineId")
           )
      )
    )::int AS "dormantLicensedBranches"
  FROM current_term ct
  JOIN "BrokerLicenseScopeLine" sl ON sl."brokerLicenseId" = ct."termId"
  GROUP BY ct."organizationId"
),
user_counts AS (
  SELECT
    u."organizationId",
    count(*)::int AS "users",
    count(*) FILTER (WHERE u."isActive")::int AS "activeUsers"
  FROM "User" u
  GROUP BY u."organizationId"
),
last_activity AS (
  -- A MAX, and therefore an OFFICE-level fact. No `userId` is selected here and none may be added:
  -- see the header. A provider needs to know whether an office is being used at all, which this
  -- answers, and does not need to know by whom, which this cannot.
  SELECT s."organizationId", max(s."lastActivityAt") AS "lastActivityAt"
  FROM "UserSession" s
  GROUP BY s."organizationId"
)
SELECT
  o."id"                                         AS "organizationId",
  o."legalName",
  o."legalNameAr",
  o."subdomain",
  o."type"::text                                 AS "organizationType",
  o."brokerKind"::text                           AS "brokerKind",
  o."status"::text                                AS "organizationStatus",
  o."createdAt"                                  AS "onboardedAt",
  ct."licenseNumber",
  ct."issuedAt"                                  AS "licenseIssuedAt",
  ct."expiresAt"                                 AS "licenseExpiresAt",
  ct."licenseStatus",
  ct."renewalRequestedAt",
  COALESCE(sc."licensedBranches", 0)             AS "licensedBranches",
  COALESCE(sc."dormantLicensedBranches", 0)      AS "dormantLicensedBranches",
  COALESCE(uc."users", 0)                        AS "users",
  COALESCE(uc."activeUsers", 0)                  AS "activeUsers",
  la."lastActivityAt"
FROM "Organization" o
LEFT JOIN current_term ct ON ct."organizationId" = o."id"
LEFT JOIN scope_counts sc ON sc."organizationId" = o."id"
LEFT JOIN user_counts uc ON uc."organizationId" = o."id"
LEFT JOIN last_activity la ON la."organizationId" = o."id";

-- SELECT only. The app role reads the dashboard and can do nothing else with it.
GRANT SELECT ON "ProviderOfficeState" TO ibms_app;
-- And explicitly nothing else, in case default privileges on new relations ever change.
REVOKE INSERT, UPDATE, DELETE ON "ProviderOfficeState" FROM ibms_app;

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  cols    TEXT;
  banned  TEXT;
BEGIN
  -- 1. The view exists and executes with its OWNER's privileges. `security_invoker = true` would
  --    make it run as the app role, which RLS then filters to the caller's own office — leaving a
  --    "cross-office dashboard" that silently shows exactly one office and looks like it works.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'ProviderOfficeState' AND relkind = 'v';
  IF n <> 1 THEN
    RAISE EXCEPTION 'provider dashboard: the view does not exist';
  END IF;
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relname = 'ProviderOfficeState'
     AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]));
  IF n <> 0 THEN
    RAISE EXCEPTION 'provider dashboard: the view is security_invoker=true, so RLS would filter it to one office and the dashboard would silently show only the caller''s own';
  END IF;

  -- 2. NO COLUMN NAMES A PERSON OR A MONEY FACT. The column list IS the privacy and commercial
  --    boundary (see the header), so it is asserted rather than trusted to a reviewer: a widened
  --    view is the one way this becomes a disclosure, and `db:divergence` cannot see a view at all.
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO cols
    FROM pg_attribute
   WHERE attrelid = '"ProviderOfficeState"'::regclass AND attnum > 0 AND NOT attisdropped;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO banned
    FROM pg_attribute
   WHERE attrelid = '"ProviderOfficeState"'::regclass AND attnum > 0 AND NOT attisdropped
     AND (
       attname ILIKE '%userId%' OR attname ILIKE '%email%' OR attname ILIKE '%phone%'
       OR attname ILIKE '%name%' AND attname NOT IN ('legalName', 'legalNameAr', 'licenseNumber')
       OR attname ILIKE '%customer%' OR attname ILIKE '%polic%' OR attname ILIKE '%premium%'
       OR attname ILIKE '%commission%' OR attname ILIKE '%capital%' OR attname ILIKE '%nationalId%'
     );
  IF banned IS NOT NULL THEN
    RAISE EXCEPTION 'provider dashboard: the view exposes column(s) it must not — %. This is a CROSS-OFFICE read: no personal data, no customer or policy data, no money. See the migration header before widening it.', banned;
  END IF;

  -- 3. The columns the service and the screen read are PRESENT. A missing one is a runtime failure
  --    in a `$queryRaw` the compiler cannot check — the repository asserts this too, and this is the
  --    half that fails at migration time rather than at request time.
  IF position('dormantLicensedBranches' IN cols) = 0
     OR position('lastActivityAt' IN cols) = 0
     OR position('renewalRequestedAt' IN cols) = 0
     OR position('licenseExpiresAt' IN cols) = 0 THEN
    RAISE EXCEPTION 'provider dashboard: the view is missing a column the service reads — it has %', cols;
  END IF;

  -- 4. The app role has SELECT and nothing else.
  IF NOT has_table_privilege('ibms_app', '"ProviderOfficeState"', 'SELECT') THEN
    RAISE EXCEPTION 'provider dashboard: ibms_app cannot SELECT the view, so the dashboard reads nothing';
  END IF;
  IF has_table_privilege('ibms_app', '"ProviderOfficeState"', 'INSERT')
     OR has_table_privilege('ibms_app', '"ProviderOfficeState"', 'UPDATE')
     OR has_table_privilege('ibms_app', '"ProviderOfficeState"', 'DELETE') THEN
    RAISE EXCEPTION 'provider dashboard: ibms_app holds a write privilege on the view';
  END IF;

  -- 5. IT REALLY DOES CROSS OFFICES. The property the whole design is for, asserted against the
  --    actual row count rather than inferred from `security_invoker`: one row per Organization.
  SELECT count(*) INTO n FROM "ProviderOfficeState";
  IF n <> (SELECT count(*) FROM "Organization") THEN
    RAISE EXCEPTION 'provider dashboard: the view returned % rows for % organizations — it is not one row per office', n, (SELECT count(*) FROM "Organization");
  END IF;

  RAISE NOTICE 'provider dashboard: view created with security_invoker=false, % columns, no personal/customer/money column, SELECT-only for ibms_app, and one row per office.', (SELECT count(*) FROM pg_attribute WHERE attrelid = '"ProviderOfficeState"'::regclass AND attnum > 0 AND NOT attisdropped);
END $$;
