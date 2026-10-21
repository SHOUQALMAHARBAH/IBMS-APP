-- MODULE 0-ب — THE PROVIDER SEES ONE FACT: THIS OFFICE MAY NOT ISSUE. Register entry 97 closes.
--
-- ## THE ARGUMENT FOR GROWING THIS VIEW BY ONE COLUMN, WHICH IS WHAT THE VIEW REQUIRES
--
-- This view's column list IS the cross-office privacy and commercial boundary, and its own header
-- says no column may be added without making the argument again. It has not grown without one since
-- it was reviewed. So: it grows by exactly ONE, and here is the argument.
--
-- **The provider registers organizations, and may not put a live one in front of customers while it
-- is barred from issuing.** That is a fact about the PLATFORM'S OWN duty, not about the office's
-- regulator file — which is why one derived boolean is enough and why nothing behind it belongs
-- here.
--
-- The owner's words: he should KNOW there is a bar; he does not need to read the detail.
--
-- ## WHAT IS DELIBERATELY NOT EXPOSED, AND THE LIST IS THE DECISION
--
-- NOT the decision reference. NOT the basis. NOT the effective date. NOT the suspended-until date.
-- NOT the letter. NOT the kind of act. A sanction's contents are the OFFICE'S: the provider neither
-- corrects them nor is bound by any deadline they carry (decision 92), so it has no use for them and
-- no business holding them. `provider-office-state.e2e-spec.ts` asserts every one of those names
-- ABSENT from the payload by an EXACT KEY SET, because an absence is the only form that can fail —
-- a list of `toHaveProperty` calls keeps passing while a new field appears beside them.
--
-- ## A CONSEQUENCE THE OWNER HAS ACCEPTED, RECORDED HERE SO NOBODY "FIXES" IT
--
-- The view already exposes `licenseNumber`, `licenseExpiresAt` and `renewalRequestedAt`. So a bar on
-- a licence whose DATES ARE STILL VALID is DISTINGUISHABLE from an expiry: a reader seeing
-- `mayNotIssue = true` beside a future expiry can infer that something other than the calendar
-- stopped this office.
--
-- That is what the owner intends — awareness of a bar — and the one fact is all that is exposed.
-- **Do not try to hide it by removing the dates:** they are the provider's own registration record,
-- entered by the provider at registration, and withdrawing them would remove the provider's access
-- to what it recorded itself in order to obscure an inference the owner has already accepted.
--
-- ## IT IS DERIVED IN SQL HERE, WHICH IS THE ONE PLACE THIS PRODUCT OTHERWISE REFUSES TO PUT IT
--
-- `ProviderOfficeState`'s header has said since module 0 item (j) that **the lapse rule is not
-- reimplemented in SQL** — the view returns dates raw and the service applies the shared function,
-- because a copy of a rule whose check order is load-bearing is a second answer to it.
--
-- That still holds, and this does not break it, because THIS IS A DIFFERENT QUESTION. The service's
-- derivation answers *is this office's latest recorded term past its expiry* — arithmetic over dates
-- the view already carries. What it CANNOT answer is whether a REGULATOR has barred the office,
-- because `RegulatoryAction` is tenant-scoped and unreachable from another office by RLS. That is
-- precisely register entry 97, and it is why the fact has to come from inside the security-definer
-- view or not at all.
--
-- What is computed below is deliberately the NARROW half: is a suspension or a cancellation standing
-- today, by the act series alone. It does NOT fold in the term arithmetic and it is NOT the six-state
-- standing — `LicenseGateService` remains the one answer to "may this office practise", for the
-- office's OWN acts, and nothing reads this column to decide anything.
--
-- ## AND THE FOLD HERE MUST AGREE WITH THE FOLD THERE, INCLUDING ITS TIE-BREAK
--
-- `effectiveFrom` is `@db.Date`, so two acts bearing one day are equal to it — which is how a
-- suspension and its same-day reinstatement resolved by query plan until the e2e caught it. The
-- `ORDER BY` below is the SAME TOTAL ORDER the api uses: `effectiveFrom`, then `recordedAt`, then
-- `id`. Written out rather than inherited, because SQL cannot import it; asserted by a test that
-- walks a same-day pair through the view.

DROP VIEW IF EXISTS "ProviderOfficeState";

CREATE VIEW "ProviderOfficeState" WITH (security_invoker = false) AS
WITH current_term AS (
  SELECT DISTINCT ON (bl."organizationId")
    bl."organizationId",
    bl."id"                 AS "termId",
    bl."licenseNumber",
    bl."issuedAt",
    bl."expiresAt",
    bl."renewalRequestedAt"
  FROM "BrokerLicense" bl
  ORDER BY bl."organizationId", bl."expiresAt" DESC, bl."id" DESC
),
-- THE STANDING ACT PER OFFICE, by the same total order the api folds on. One row per organization:
-- the LAST act in that order, whatever its kind.
standing_act AS (
  SELECT DISTINCT ON (ra."organizationId")
    ra."organizationId",
    ra."kind"
  FROM "RegulatoryAction" ra
  -- Only acts already IN FORCE. `effectiveFrom` is a DATE and is compared against the current date
  -- for that reason — an act dated tomorrow is recorded and not yet biting.
  WHERE ra."effectiveFrom" <= CURRENT_DATE
  ORDER BY
    ra."organizationId",
    ra."effectiveFrom" DESC,
    ra."recordedAt" DESC,
    ra."id" DESC
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
  ct."renewalRequestedAt",
  -- THE ONE NEW FACT. A suspension or a cancellation standing today bars new issuance; a
  -- reinstatement (or no act at all) does not. FALSE rather than NULL for an office with no acts,
  -- because "no regulator has barred this office" is a definite answer and a null would make a
  -- reader guess whether it means unknown.
  ((sa."kind" IN ('SUSPENSION', 'CANCELLATION')) IS TRUE) AS "mayNotIssue",
  COALESCE(sc."licensedBranches", 0)             AS "licensedBranches",
  COALESCE(sc."dormantLicensedBranches", 0)      AS "dormantLicensedBranches",
  COALESCE(uc."users", 0)                        AS "users",
  COALESCE(uc."activeUsers", 0)                  AS "activeUsers",
  la."lastActivityAt"
FROM "Organization" o
LEFT JOIN current_term ct ON ct."organizationId" = o."id"
LEFT JOIN standing_act sa ON sa."organizationId" = o."id"
LEFT JOIN scope_counts sc ON sc."organizationId" = o."id"
LEFT JOIN user_counts uc ON uc."organizationId" = o."id"
LEFT JOIN last_activity la ON la."organizationId" = o."id"
WHERE o."type" IN ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');

-- Re-granted, because DROP VIEW took the old grant with it: a recreated view with no grant makes
-- the provider dashboard 500 for every reader while this migration reports success.
GRANT SELECT ON "ProviderOfficeState" TO ibms_app;

DO $$
DECLARE
  view_cols INT;
  invoker TEXT;
  leaked TEXT;
BEGIN
  SELECT count(*) INTO view_cols
  FROM information_schema.columns WHERE table_name = 'ProviderOfficeState';
  IF view_cols <> 18 THEN
    RAISE EXCEPTION 'the provider view should carry 18 columns — 17 plus mayNotIssue — found %', view_cols;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProviderOfficeState' AND column_name = 'mayNotIssue'
  ) THEN
    RAISE EXCEPTION 'the one new fact is missing';
  END IF;

  -- AND NOTHING BEHIND IT. Asserted BY NAME, in the migration, because this is the boundary and a
  -- later `CREATE OR REPLACE` adding "just the decision reference" is exactly the change that needs
  -- to fail here rather than in review.
  SELECT string_agg(column_name, ', ') INTO leaked
  FROM information_schema.columns
  WHERE table_name = 'ProviderOfficeState'
    AND column_name IN (
      'decisionRef', 'regulatoryDecisionRef', 'basis', 'regulatoryBasis',
      'effectiveFrom', 'suspendedUntil', 'documentId', 'kind', 'regulatoryActionKind',
      'standingActDecisionRef', 'licenseStatus'
    );
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'the view exposes regulatory detail the provider must not hold: %', leaked;
  END IF;

  SELECT COALESCE((
    SELECT option FROM unnest(c.reloptions) AS option
     WHERE option LIKE 'security_invoker%'
  ), 'unset') INTO invoker
  FROM pg_class c WHERE c.oid = 'public."ProviderOfficeState"'::regclass;
  IF invoker = 'security_invoker=true' THEN
    RAISE EXCEPTION 'security_invoker was reset to true, so the view would be filtered by RLS to the office of whoever is reading it. That is the whole reason this view exists, and it looks perfectly correct on a single-office database.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'ProviderOfficeState'
      AND grantee = 'ibms_app' AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'ibms_app lost SELECT on the provider view — DROP VIEW takes the grant with it';
  END IF;

  RAISE NOTICE 'the provider view carries % columns including mayNotIssue, nothing behind it, security_invoker %', view_cols, invoker;
END $$;
