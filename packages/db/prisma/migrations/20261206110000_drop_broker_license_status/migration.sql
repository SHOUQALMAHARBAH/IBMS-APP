-- MODULE 0-ب, THE LICENCE — DROP `BrokerLicense.status`, the third answer to "is this office
-- licensed".
--
-- ## WHY THERE WERE THREE, AND WHAT EACH ONE WAS
--
-- MEASURED before any of this was touched:
--
--   (a) `deriveLicenseStanding` — decision 71's SIX states, with `mayPractise` beside them — had
--       **zero non-spec consumers**. The considered answer enforced nothing.
--   (b) `PolicyService.assertLicenseNotLapsed` computed its own from the dates, was PRIVATE, and had
--       exactly ONE caller: the policy-creation path. Every other art. 21/a/9 occurrence in the tree
--       is a comment, a display string or the provider dashboard's wording.
--   (c) THIS COLUMN — `status String @default("active") // active | lapsed` — two values against the
--       derivation's six, written by one route that took no body at all.
--
-- The consequence was concrete: a CBJ SUSPENSION blocked nothing, and the regulatory-compliance
-- screen rendered the stored flag AND the live-derived `isCurrentlyLapsed` side by side.
--
-- ## THE ORDER THE REGISTER REQUIRED, FOLLOWED
--
-- `docs/deferred-register.md` entry 12: **"record acts for whatever the marker was standing in for,
-- THEN drop the column — never the reverse, which would lose the fact before it was recorded
-- anywhere."**
--
--   1. `RegulatoryAction` got its FIRST writer — `POST /broker-license/regulatory-actions`, the
--      office's own record of a CBJ letter, carrying the kind, the basis, the effective date, the
--      decision reference and the document. Measured: that table had appeared in exactly ONE
--      non-spec file before, the derivation that READS it, so its suspension and cancellation
--      branches consumed rows nothing could create.
--   2. `POST /broker-license/mark-lapsed` and `BrokerLicenseRepository.markLapsed` are gone, so
--      nothing can write this column any more.
--   3. Only then, this.
--
-- ## AND NOTHING REAL IS LOST, MEASURED RATHER THAN HOPED
--
-- dev holds 3 licence terms, ALL `active`. db-test holds 4 active and 3 `lapsed`, and every lapsed
-- one is an e2e artefact. So there was no real manual lapse standing in for a CBJ decision — the
-- precondition entry 12 set is satisfied by the data, not by an argument.
--
-- ## THE RULE THE COLUMN CARRIED MOVED, IT WAS NOT DELETED
--
-- Its guard came FIRST in `isBrokerLicenseCurrentlyLapsed` deliberately: *"a CBJ suspension is not
-- cured by having filed a renewal application, and ordering the checks the other way would let a
-- timely filing paper over a regulator's own intervention."* That ordering now lives in
-- `deriveLicenseStanding`, whose header already states it — *"the REGULATOR'S ACTS outrank the term
-- arithmetic"* — and `license-standing.config.spec.ts` asserts it over a real act, with a timely
-- renewal filing in play, so the property is proven rather than assumed to have survived.

-- ## THE VIEW DEPENDS ON IT, AND THAT WAS FOUND BY THE DROP FAILING RATHER THAN BY READING
--
-- `cannot drop column status of table "BrokerLicense" because other objects depend on it — view
-- "ProviderOfficeState" depends on column status of table "BrokerLicense"`.
--
-- So the view is recreated first, WITHOUT the column. Three things follow and all three are
-- deliberate:
--
--   * the view's column list SHRINKS, which makes the cross-office privacy boundary narrower and so
--     needs no new argument — `security-definer-views.e2e-spec.ts` and the repository's runtime
--     check both move with it, because `db:divergence` is blind to a view and they are the only
--     guards there are;
--   * the provider dashboard loses its OWN second answer: `toProviderOfficeStateView` was rebuilding
--     a term object as `{ status: row.licenseStatus ?? 'active', … }` and handing it to the lapse
--     rule, so the screen rendered a stored flag beside a live derivation;
--   * and `security_invoker = false` is re-stated explicitly, because `CREATE OR REPLACE VIEW`
--     without it would silently reset the option and the view would start being filtered by RLS to
--     the caller's own office — which on a single-office database looks exactly correct. That is the
--     trap this view's own header records.

-- DROP AND CREATE, NOT `CREATE OR REPLACE` — Postgres refuses the latter when a column goes:
-- `cannot drop columns from view`. Which means the view's GRANT goes with it, so it is re-granted
-- below: measured first, `ibms_app` holds SELECT and nothing else on it, and a recreated view with
-- no grant would make the provider dashboard 500 for everybody while the migration reported success.
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
-- UNCHANGED: the two registered organization types, PROVIDER still excluded for the original reason
-- — it would be reported as an office with no licence term, a false finding about a regulatory
-- failure.
WHERE o."type" IN ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');

-- Re-granted, because DROP VIEW took the old grant with it.
GRANT SELECT ON "ProviderOfficeState" TO ibms_app;

ALTER TABLE "BrokerLicense" DROP COLUMN "status";

DO $$
DECLARE
  remaining INT;
  acts INT;
  view_cols INT;
  invoker TEXT;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_attribute
  WHERE attrelid = 'public."BrokerLicense"'::regclass
    AND attnum > 0 AND NOT attisdropped AND attname = 'status';
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'the status column is still present — the DROP did not take';
  END IF;

  -- AND THE REPLACEMENT EXISTS. Asserted here rather than left to a code review, because dropping
  -- the marker without the act table would remove the office's only way to record that its licence
  -- was suspended — a capability regression wearing the clothes of a cleanup.
  SELECT count(*) INTO acts
  FROM pg_attribute
  WHERE attrelid = 'public."RegulatoryAction"'::regclass
    AND attnum > 0 AND NOT attisdropped
    AND attname IN ('kind', 'basis', 'effectiveFrom', 'decisionRef', 'documentId', 'suspendedUntil');
  IF acts <> 6 THEN
    RAISE EXCEPTION 'RegulatoryAction does not carry the six fields that replace the marker — found %', acts;
  END IF;

  -- THE VIEW'S OWN TWO PROPERTIES, re-asserted because `db:divergence` cannot see a view and
  -- `CREATE OR REPLACE` is where `security_invoker` gets silently reset. As `true` the view is
  -- filtered by RLS to the caller's own office and looks perfectly correct on a single-office
  -- database — which is the failure mode this view's header exists to warn about.
  SELECT count(*) INTO view_cols
  FROM information_schema.columns
  WHERE table_name = 'ProviderOfficeState';
  IF view_cols <> 17 THEN
    RAISE EXCEPTION 'the provider view should carry 17 columns after losing licenseStatus — found %', view_cols;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProviderOfficeState' AND column_name = 'licenseStatus'
  ) THEN
    RAISE EXCEPTION 'the view still exposes licenseStatus';
  END IF;
  SELECT COALESCE((
    SELECT option FROM unnest(c.reloptions) AS option
     WHERE option LIKE 'security_invoker%'
  ), 'unset') INTO invoker
  FROM pg_class c WHERE c.oid = 'public."ProviderOfficeState"'::regclass;
  IF invoker = 'security_invoker=true' THEN
    RAISE EXCEPTION 'security_invoker was reset to true — the view would be filtered by RLS to the caller''s own office and look correct on a single-office database';
  END IF;

  -- AND THE GRANT, because DROP VIEW silently took it: without this the dashboard would 500 for
  -- every reader while this migration reported success.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'ProviderOfficeState'
      AND grantee = 'ibms_app' AND privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'ibms_app lost SELECT on the provider view — DROP VIEW takes the grant with it';
  END IF;

  RAISE NOTICE 'BrokerLicense.status dropped; the provider view carries % columns, security_invoker is %, and ibms_app still holds SELECT', view_cols, invoker;
END $$;
