-- THE FULL WALK §A ITEM 11 — THE FIRST ADMINISTRATOR'S INVITE CANNOT BE SENT AGAIN, AND THE ROUTE
-- WOULD HAVE ACCEPTED IT ALL ALONG.
--
-- ## WHAT WAS MEASURED
--
-- With no provider mailbox connected, `POST /provider/brokerage-offices/:id/administrator` creates
-- the OFFICE_ADMINISTRATOR account, reports `invitation.outcome !== 'SENT'`, and tells the operator
-- in its own shipped sentence: «اربط بريد المزوّد … ثم أعد الدعوة — تُصدر رابطاً جديداً ولا تُنشئ
-- حساباً ثانياً» («connect the provider mailbox … then re-invite — that issues a fresh link and
-- creates no second account»).
--
-- THAT RE-INVITE IS ALREADY BUILT. `resolveInvitationTarget` returns `mode: 'REINVITE'` for exactly
-- one account that nobody has ever entered, and `InvitationChannelService.deliver` invalidates every
-- earlier token and issues one fresh link. ⛔ So no route and no permission code is needed here, and
-- none was added.
--
-- WHAT IS MISSING IS THAT THE SCREEN HIDES THE CONTROL. `/provider-offices` offers the invite only
-- while `office.users === 0`, and its own comment called that «the honest test» because «the invite
-- route itself refuses once the organization has ANY account». That stopped being true when the
-- REINVITE branch landed: the route refuses once anybody has ENTERED, not once an account exists. So
-- an office with one never-used account reads «له حساب» with no control, while the api would accept
-- the very act its error message recommends.
--
-- ## THE ARGUMENT FOR GROWING THIS VIEW BY ONE COLUMN, WHICH IS WHAT THE VIEW REQUIRES
--
-- **The screen must test what the ROUTE tests, or it offers a control that can only 403** — the dead
-- control `docs/frontend-ux-directive.md` rules out. `resolveInvitationTarget`'s predicate is
-- `lastLoginAt IS NOT NULL OR passwordUpdatedAt IS NOT NULL`, and the view carried no count of it.
--
-- ⚠️ AND `lastActivityAt` IS NOT THAT PREDICATE, which is why it could not be reused. It is a MAX
-- over `UserSession`, so it is null for somebody who set their password through the invitation link
-- and never completed a session — `passwordUpdatedAt` set, no session row. The screen would have
-- offered the control and the route would have refused with 409.
--
-- **It is a COUNT, of the same class as the two already here.** `users` and `activeUsers` are
-- office-level counts and this is a third: how many accounts have ever been used. No person is
-- named, no date is exposed, and ⛔ NOT `lastLoginAt` or `passwordUpdatedAt` themselves — when a
-- named individual in another office last signed in is that office's record, and a count is not.
--
-- ## ⛔ AND REGISTER ENTRY 97'S BOUNDARY IS UNTOUCHED
--
-- No regulatory detail, no licence field, no personal data. The banned-name assertion is carried
-- over verbatim and widened by the two column names this change could have reached for and did not.

DROP VIEW IF EXISTS "ProviderOfficeState";

CREATE VIEW "ProviderOfficeState" WITH (security_invoker = false) AS
WITH current_term AS (
  SELECT DISTINCT ON (bl."organizationId")
    bl."organizationId",
    bl."id"                 AS "termId",
    bl."licenseNumber",
    bl."issuedAt",
    bl."expiresAt",
    bl."renewalRequestedAt",
    -- The renewal bits, as BITS. The document id and the Central Bank's reference number are read
    -- here and never selected: what leaves this CTE is whether each is present.
    (bl."renewalProofDocumentId" IS NOT NULL)                       AS "renewalProofOnRecord",
    (COALESCE(TRIM(bl."renewalReferenceNumber"), '') <> '')         AS "renewalReferenceOnRecord"
  FROM "BrokerLicense" bl
  ORDER BY bl."organizationId", bl."expiresAt" DESC, bl."id" DESC
),
-- Whether anybody declared, and nothing about who. `actorNameShown` and `declaredAt` are
-- deliberately not selected — they name an employee of another office.
renewal_declaration AS (
  SELECT ct."organizationId", TRUE AS "renewalDeclarationOnRecord"
  FROM current_term ct
  JOIN "LicenseRenewalDeclaration" d ON d."brokerLicenseId" = ct."termId"
),
-- THE STANDING ACT PER OFFICE, by the same total order the api folds on. UNCHANGED.
standing_act AS (
  SELECT DISTINCT ON (ra."organizationId")
    ra."organizationId",
    ra."kind"
  FROM "RegulatoryAction" ra
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
    count(*) FILTER (WHERE u."isActive")::int AS "activeUsers",
    -- THE ONE NEW FACT. The SAME predicate `resolveInvitationTarget` uses, written out here because
    -- SQL cannot import it — and a test walks a never-entered office through both so the copy
    -- cannot drift into disagreeing with the route the screen's control calls.
    count(*) FILTER (
      WHERE u."lastLoginAt" IS NOT NULL OR u."passwordUpdatedAt" IS NOT NULL
    )::int AS "enteredUsers"
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
  COALESCE(ct."renewalProofOnRecord", FALSE)     AS "renewalProofOnRecord",
  COALESCE(ct."renewalReferenceOnRecord", FALSE) AS "renewalReferenceOnRecord",
  COALESCE(rd."renewalDeclarationOnRecord", FALSE) AS "renewalDeclarationOnRecord",
  ((sa."kind" IN ('SUSPENSION', 'CANCELLATION')) IS TRUE) AS "mayNotIssue",
  COALESCE(sc."licensedBranches", 0)             AS "licensedBranches",
  COALESCE(sc."dormantLicensedBranches", 0)      AS "dormantLicensedBranches",
  COALESCE(uc."users", 0)                        AS "users",
  COALESCE(uc."activeUsers", 0)                  AS "activeUsers",
  COALESCE(uc."enteredUsers", 0)                 AS "enteredUsers",
  la."lastActivityAt"
FROM "Organization" o
LEFT JOIN current_term ct ON ct."organizationId" = o."id"
LEFT JOIN renewal_declaration rd ON rd."organizationId" = o."id"
LEFT JOIN standing_act sa ON sa."organizationId" = o."id"
LEFT JOIN scope_counts sc ON sc."organizationId" = o."id"
LEFT JOIN user_counts uc ON uc."organizationId" = o."id"
LEFT JOIN last_activity la ON la."organizationId" = o."id"
WHERE o."type" IN ('BROKERAGE_OFFICE', 'INSURANCE_COMPANY');

-- Re-granted, because DROP VIEW took the old grant with it.
GRANT SELECT ON "ProviderOfficeState" TO ibms_app;

DO $$
DECLARE
  view_cols INT;
  invoker TEXT;
  leaked TEXT;
  missing TEXT;
BEGIN
  SELECT count(*) INTO view_cols
  FROM information_schema.columns WHERE table_name = 'ProviderOfficeState';
  IF view_cols <> 22 THEN
    RAISE EXCEPTION 'the provider view should carry 22 columns — 21 plus enteredUsers — found %', view_cols;
  END IF;

  SELECT string_agg(needed, ', ') INTO missing
  FROM unnest(ARRAY[
    'renewalProofOnRecord', 'renewalReferenceOnRecord', 'renewalDeclarationOnRecord',
    'enteredUsers', 'mayNotIssue'
  ]) AS needed
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProviderOfficeState' AND column_name = needed
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the derived facts the provider screen reads are missing: %', missing;
  END IF;

  -- AND NOTHING BEHIND ANY OF THEM. Asserted BY NAME, because this is the boundary.
  --
  -- WIDENED BY TWO NAMES with this migration: `lastLoginAt` and `passwordUpdatedAt` are what the new
  -- count is computed FROM, and when a named individual in another office last signed in is that
  -- office's record. A count of accounts ever used is not.
  SELECT string_agg(column_name, ', ') INTO leaked
  FROM information_schema.columns
  WHERE table_name = 'ProviderOfficeState'
    AND column_name IN (
      'decisionRef', 'regulatoryDecisionRef', 'basis', 'regulatoryBasis',
      'effectiveFrom', 'suspendedUntil', 'documentId', 'kind', 'regulatoryActionKind',
      'standingActDecisionRef', 'licenseStatus',
      'renewalProofDocumentId', 'renewalReferenceNumber',
      'actorNameShown', 'declaredAt',
      'lastLoginAt', 'passwordUpdatedAt', 'email'
    );
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'the view exposes regulatory or personal detail the provider must not hold: %', leaked;
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

  RAISE NOTICE 'the provider view carries % columns including enteredUsers, nothing behind it, security_invoker %', view_cols, invoker;
END $$;
