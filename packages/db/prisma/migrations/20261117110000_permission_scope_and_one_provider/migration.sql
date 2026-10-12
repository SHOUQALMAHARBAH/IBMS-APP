-- MODULE 0 ITEM (j), GAP CLOSURE — exactly one PROVIDER organization, and a PLATFORM permission
-- class the office role builder cannot grant itself.
--
-- ============================================================================================
-- THE PERMISSION SCOPE COLUMN IS THE DESIGN THIS CODEBASE ALREADY NAMED
-- ============================================================================================
-- `permissions.ts`'s own header states the invariant item (j) broke:
--
--   "No code in this grid may have an effect outside the granting office. Every permission here is
--    granted BY an office TO its own roles, so its effect must stop at that office."
--
-- and then records the design it DEFERRED, with the reason:
--
--   "The proposed fix was a `Permission.scope` column with a server-side refusal and a matrix
--    filter: real machinery to make one permission special. What actually fixed it was scoping the
--    TEMPLATE to the office, after which the code's effect no longer crossed anything and the scope
--    column had zero cases... If a genuinely platform-wide capability is ever needed, the column is
--    the same work then, WITH A REAL CASE TO TEST AGAINST."
--
-- `provider.office-state.read` is that real case, and this is that column. It is not a new
-- mechanism invented for one code; it is the one the file said to build when a case existed.
--
-- Unlike `insurer.form.map` — where the cure belonged at the TABLE and the scope column would have
-- been machinery around a mis-scoped model — there is nothing to re-scope here. The dashboard's
-- whole purpose is to span tenants, which is why it is a SECURITY DEFINER view in the first place.
--
-- DEFAULT 'OFFICE', and that default IS honest, unlike `Organization.type`'s absence of one: OFFICE
-- is the NON-WIDENING value. Every one of the 219 pre-existing codes is office-scoped, and a code
-- added later without a decision must not become platform-wide by omission. Same reasoning as
-- `dutySegregationMode` defaulting to SEGREGATED and the opposite of item (a), where neither value
-- was stricter.
--
-- ============================================================================================
-- "EXACTLY ONE PROVIDER" IS A PARTIAL UNIQUE INDEX, NOT SERVICE CODE
-- ============================================================================================
-- This is a rule a single row of a single table can answer, which is precisely what art. 3/a and
-- the role-scope rule were NOT — those needed three tables, which is why they are service-grain and
-- are recorded as such. Here the database can hold it, so the database holds it.
--
-- UNIQUE on `type` among rows WHERE `type = 'PROVIDER'`: at most one row can satisfy the predicate,
-- so a second provider organization is unINSERTable rather than merely refused by whatever code
-- happens to run. `db:divergence` is blind to a partial index (a recorded blind spot), so this
-- migration asserts it by reading `pg_get_indexdef` and requiring the WHERE clause to still be
-- there — an index recreated without it would be a unique constraint on `type` itself, which would
-- reject the SECOND BROKERAGE OFFICE and look like a tenancy bug.
--
-- ============================================================================================
-- THE VIEW NOW LISTS BROKERAGE OFFICES ONLY
-- ============================================================================================
-- `ProviderOfficeState` selected every `Organization`. With a PROVIDER row existing, that would
-- report the provider itself as an office with "no licence term on record — new business blocked
-- (art. 21/a/9)", which is a FALSE FINDING of exactly the kind this project keeps removing: a
-- confident sentence about a regulatory failure that is not one. The same was already true of an
-- INSURANCE_COMPANY row.
--
-- So the view is filtered to BROKERAGE_OFFICE. `CREATE OR REPLACE VIEW` keeps the column list, order
-- and types identical — only the WHERE changes — so the repository's declared column list and the
-- SECURITY DEFINER registry are untouched.

CREATE TYPE "PermissionScope" AS ENUM ('OFFICE', 'PLATFORM');

ALTER TABLE "Permission"
  ADD COLUMN "scope" "PermissionScope" NOT NULL DEFAULT 'OFFICE';

-- At most one PROVIDER organization. See the header for why this is an index and not a service
-- check, and for what a recreated-without-WHERE version would break.
CREATE UNIQUE INDEX "Organization_one_provider"
  ON "Organization" ("type")
  WHERE "type" = 'PROVIDER';

CREATE OR REPLACE VIEW "ProviderOfficeState" WITH (security_invoker = false) AS
WITH current_term AS (
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
  o."status"::text                               AS "organizationStatus",
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
LEFT JOIN last_activity la ON la."organizationId" = o."id"
-- BROKERAGE OFFICES ONLY. See the header: a PROVIDER or INSURANCE_COMPANY row would be reported as
-- an office with no licence term, which is a false finding about a regulatory failure.
WHERE o."type" = 'BROKERAGE_OFFICE';

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- 1. The scope enum has exactly two values, and every existing code is OFFICE. A code that came
  --    out of this migration already PLATFORM would be a capability widened by a migration, which
  --    is the thing item (a)'s no-default argument exists to prevent.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'PermissionScope';
  IF n <> 2 THEN
    RAISE EXCEPTION 'permission scope: expected 2 values (OFFICE, PLATFORM), found %', n;
  END IF;
  SELECT count(*) INTO n FROM "Permission" WHERE "scope" <> 'OFFICE';
  IF n <> 0 THEN
    RAISE EXCEPTION 'permission scope: % permission(s) came out of this migration already PLATFORM — a migration must not widen a capability', n;
  END IF;

  -- 2. THE PARTIAL UNIQUE IS PRESENT AND STILL PARTIAL. Without the WHERE it becomes a unique
  --    constraint on `type` itself, which would reject the SECOND BROKERAGE OFFICE — a tenancy bug
  --    wearing the costume of a provider rule.
  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'Organization_one_provider';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('PROVIDER' IN def) = 0 THEN
    RAISE EXCEPTION 'one provider: the partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 3. PROVEN, not asserted: two provider rows are refused by the DATABASE. Done in a nested block
  --    that rolls itself back, so the check leaves nothing behind — and it writes through the OWNER,
  --    which is the harshest caller there is.
  BEGIN
    INSERT INTO "Organization" ("id", "legalName", "type", "subdomain", "updatedAt")
      VALUES ('00000000-0000-0000-0000-00000000f001', 'Probe Provider A', 'PROVIDER', 'probe-prov-a', now());
    INSERT INTO "Organization" ("id", "legalName", "type", "subdomain", "updatedAt")
      VALUES ('00000000-0000-0000-0000-00000000f002', 'Probe Provider B', 'PROVIDER', 'probe-prov-b', now());
    RAISE EXCEPTION 'one provider: TWO provider organizations were accepted — the partial unique refuses nothing';
  EXCEPTION
    WHEN unique_violation THEN
      -- What we wanted. The first insert is rolled back with this sub-block.
      NULL;
  END;
  -- And nothing was left behind by the probe.
  SELECT count(*) INTO n FROM "Organization" WHERE "id" IN (
    '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000f002');
  IF n <> 0 THEN
    RAISE EXCEPTION 'one provider: the refusal probe leaked % row(s)', n;
  END IF;

  -- 4. The view still has its 18 columns and now lists BROKERAGE OFFICES ONLY. The column set is
  --    asserted because the repository's declared list and the SECURITY DEFINER registry both
  --    reference it, and `CREATE OR REPLACE VIEW` is exactly where a column could have moved.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"ProviderOfficeState"'::regclass AND attnum > 0 AND NOT attisdropped;
  IF n <> 18 THEN
    RAISE EXCEPTION 'provider dashboard: the view has % columns, expected 18 — a replace changed its shape', n;
  END IF;
  SELECT count(*) INTO n FROM "ProviderOfficeState";
  IF n <> (SELECT count(*) FROM "Organization" WHERE "type" = 'BROKERAGE_OFFICE') THEN
    RAISE EXCEPTION 'provider dashboard: the view returned % rows for % brokerage office(s)', n, (SELECT count(*) FROM "Organization" WHERE "type" = 'BROKERAGE_OFFICE');
  END IF;

  -- 5. The replace did not silently flip the view to security_invoker, which would make it
  --    RLS-filtered to one office and look correct on a single-office database.
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relname = 'ProviderOfficeState'
     AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]));
  IF n <> 0 THEN
    RAISE EXCEPTION 'provider dashboard: the replaced view is security_invoker=true';
  END IF;

  RAISE NOTICE 'provider gap: PermissionScope added (all % codes OFFICE), one-provider partial unique PROVEN to refuse a second, and the view filtered to % brokerage office(s) with 18 columns and security_invoker=false.', (SELECT count(*) FROM "Permission"), (SELECT count(*) FROM "Organization" WHERE "type" = 'BROKERAGE_OFFICE');
END $$;
