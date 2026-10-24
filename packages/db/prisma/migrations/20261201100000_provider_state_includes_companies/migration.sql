-- BATCH 5, ITEM (و)'s WAY IN — THE VIEW NOW CARRIES REGISTERED INSURANCE COMPANIES TOO.
--
-- ## WHY THIS HAD TO MOVE AT ALL
--
-- Item (و) was recorded as done after batch 3 and was not: the route, decision 18 and the invited
-- role are all correct and proven over HTTP, and NO WEB CODE CALLS EITHER INVITE ROUTE. Measured:
-- the web client reaches `POST /provider/brokerage-offices` and `POST /provider/insurance-companies`
-- and nothing else. So the provider can create a tenant by clicking and can never put the first
-- person into it.
--
-- Measured consequence on dev: THREE organizations hold zero users — `goglobal` (the office the
-- owner registered), `almanarah` and `alnourcompany` (the two companies). Nobody can sign into any
-- of them.
--
-- The surface is one control on the organization row of `/provider-offices`, because this acts on an
-- organization the reader is already looking at. For that to serve BOTH organization types — the
-- same act, and the alternative is building the screen twice — the rows have to be there, and
-- MEASURED: no route in this product lists `INSURANCE_COMPANY` organizations at all. Every
-- occurrence outside this view is a single-row read or a type guard. So there was nothing to union
-- the screen against, and the view is the one place that answers "which organizations exist".
--
-- ## WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--
-- ONE LINE: the WHERE. `CREATE OR REPLACE VIEW` requires the column list, its order and its types to
-- be identical, and they are — the definition below is the `20261117110000` body with its final
-- predicate widened, so the COLUMN LIST IS BYTE-FOR-BYTE THE ONE THAT WAS REVIEWED.
--
-- That matters more than it looks: the column list IS the privacy and commercial boundary of this
-- view, guarded in three places (this file's assertions, the repository's runtime check against
-- `PROVIDER_OFFICE_STATE_COLUMNS`, and an api e2e asserting each banned key is absent from the
-- response body). None of those three moves here, because nothing crosses the boundary that did not
-- cross it before: an insurance company's identity, status, user counts and last activity are the
-- same eighteen facts, about a company the provider itself registered.
--
-- PROVIDER STAYS EXCLUDED. That is the whole reason the filter exists: with the provider row in, the
-- unfiltered view reported the provider as an office with "no licence term on record — new business
-- blocked", a FALSE FINDING ABOUT A REGULATORY FAILURE. The assertions below pin its absence.
--
-- ## THE FALSE FINDING THIS WIDENING COULD REINTRODUCE, ONE TYPE OVER
--
-- An insurance company has no broker licence by nature, so every licence column is NULL for it and
-- `toProviderOfficeStateView` maps that to `isCurrentlyLapsed = null` — which for an OFFICE means
-- "no licence term on record", a state item (c) made BLOCK new business under art. 21/a/9.
--
-- Rendered unbranched, the screen would tell the reader that a registered insurance company is in
-- regulatory default. That is the same defect the `BROKERAGE_OFFICE` filter was added to prevent,
-- and widening without a branch would simply move it from PROVIDER to INSURANCE_COMPANY.
--
-- The view already carries `organizationType`, so the branch costs no query and no column. It is
-- the SCREEN's job, and `provider-offices.spec.ts` asserts both halves: a company row carries no
-- licence notice, and an office with no term still does. Dropping the branch kills that test.
--
-- The lapse rule itself is NOT touched and is still applied in TypeScript by
-- `isBrokerLicenseCurrentlyLapsed` — never copied into this SQL.

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
-- THE TWO REGISTERED ORGANIZATION TYPES. PROVIDER is still excluded, and for the original reason:
-- it would be reported as an office with no licence term, a false finding about a regulatory failure.
WHERE o."type" IN ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');

-- ---------------------------------------------------------------------------------------------
-- THE ASSERTIONS. `db:divergence` CANNOT SEE A VIEW AT ALL — verified when this view was created
-- and still true — so these and the repository's runtime check are the only things between the
-- column list and a future migration quietly changing it.
DO $$
DECLARE
  n_cols   integer;
  invoker  text;
  n_rows   integer;
  n_expect integer;
  n_prov   integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_name = 'ProviderOfficeState';
  IF n_cols <> 18 THEN
    RAISE EXCEPTION 'provider state: expected 18 columns, found % — the column list is the privacy boundary and may not change here', n_cols;
  END IF;

  SELECT COALESCE((SELECT option_value
                     FROM pg_options_to_table(c.reloptions)
                    WHERE option_name = 'security_invoker'), 'false')
    INTO invoker
    FROM pg_class c WHERE c.relname = 'ProviderOfficeState';
  IF invoker <> 'false' THEN
    RAISE EXCEPTION 'provider state: security_invoker is %, must stay false or the cross-office read stops working', invoker;
  END IF;

  SELECT count(*) INTO n_rows FROM "ProviderOfficeState";
  SELECT count(*) INTO n_expect FROM "Organization" WHERE "type" IN ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');
  IF n_rows <> n_expect THEN
    RAISE EXCEPTION 'provider state: the view returned % rows for % registered organization(s)', n_rows, n_expect;
  END IF;

  -- The one the original filter exists for. Asserted as a ZERO rather than a total, so a second
  -- provider (which the partial unique refuses anyway) could not make this pass by arithmetic.
  SELECT count(*) INTO n_prov
    FROM "ProviderOfficeState" s
    JOIN "Organization" o ON o."id" = s."organizationId"
   WHERE o."type" = 'PROVIDER';
  IF n_prov <> 0 THEN
    RAISE EXCEPTION 'provider state: % PROVIDER row(s) reached the view — it would be reported as an office in regulatory default', n_prov;
  END IF;

  RAISE NOTICE 'provider state: 18 columns, security_invoker=false, % row(s) across BROKERAGE_OFFICE+INSURANCE_COMPANY, 0 PROVIDER rows.', n_rows;
END $$;
