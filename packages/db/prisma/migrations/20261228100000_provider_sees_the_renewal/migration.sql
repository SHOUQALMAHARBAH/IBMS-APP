-- THE FULL WALK §A ITEM 10 / DECISION 167/17 — THE PROVIDER SCREEN PRINTED «ساري» FOR AN OFFICE
-- PAST ITS PRINTED EXPIRY, AND THE TWO RENEWAL FACTS IT NEEDED WERE THE ONLY ONES MISSING.
--
-- ## WHAT WAS MEASURED, BEFORE ANYTHING WAS CHANGED
--
-- `scripts/measurements/licence-standing-two-screens.ts` ran the three shipped functions over
-- every office's REAL licence row on the owner's dev database, 2026-11-28:
--
--   demo-office-b  term expires 2025-12-31, filed 2025-11-01, proof on record, ref on record,
--                  declaration on record (مريم منصور حسين الزعبي, 2026-11-25), 0 acts
--                  deriveRenewalUnderStudy  -> UNDER_STUDY
--                  deriveLicenseStanding    -> RENEWAL_PENDING, mayPractise = true
--                  isBrokerLicenseCurrentlyLapsed -> false   (DATE-ONLY)
--                  /regulatory-compliance prints «قيدَ التجديد»
--                  /provider-offices      prints «ساري»          <- the defect
--
-- So decision 167/17's FIRST branch holds: the office really is under renewal, the new-business
-- block is lifted BY RIGHT under decision 128, and only the provider screen's WORD was wrong. The
-- ruling is then «تُصحَّح كلمة شاشة المزوّد لتطابق شاشة الترخيص» — correct the word to match.
--
-- ## WHY THE WORD COULD NOT BE CORRECTED WITHOUT TOUCHING THIS VIEW
--
-- `/provider-offices` printed a four-way branch over `isCurrentlyLapsed`, the DATE-ONLY lapse, and
-- named its negation with «ساري» — a word `compliance-risk.ts` reserves, in decision 128's own
-- words, for «a term INSIDE its printed dates and nothing else». Past expiry that boolean is
-- `!renewalFiledOnTime`, which is `false` for FOUR different renewal states: NO_PROOF,
-- AWAITING_DECLARATION, ENDED_BY_ACT and UNDER_STUDY. Three of those four are EXPIRED with
-- `mayPractise = false`. The screen called all four «ساري».
--
-- `deriveRenewalUnderStudy` tells them apart from five licence fields. The view carried TWO of
-- them (`expiresAt`, `renewalRequestedAt`) and not the other three.
--
-- ## THE ARGUMENT FOR GROWING THIS VIEW BY TWO COLUMNS, WHICH IS WHAT THE VIEW REQUIRES
--
-- This view's column list IS the cross-office privacy and commercial boundary, and its own header
-- requires the argument to be made again before any column is added. So: it grows by exactly TWO,
-- and here is the argument.
--
-- **Both are facts about the RENEWAL OF A LICENCE THE PROVIDER ITSELF REGISTERED, and the view
-- already carries three of that same set.** `licenseNumber`, `licenseExpiresAt` and
-- `renewalRequestedAt` are there today, and register entry 97 calls them in terms «the provider's
-- own registration record, entered by the provider at registration». *Has the office filed its
-- proof* and *has somebody in the office sworn the standing declaration* are the same class of
-- fact about the same renewal of the same term — not a regulator's act, and not personal data.
--
-- ## AND THEY ARE BOOLEANS, WHICH IS THE WHOLE OF THE NARROWING
--
-- NOT the proof DOCUMENT ID — the provider has no business reaching another office's document.
-- NOT the reference number the Central Bank issued. NOT the declaring person's NAME and NOT the
-- date they declared: `LicenseRenewalDeclaration.actorNameShown` is an employee of another office,
-- and «who swore it» is that office's record. `/regulatory-compliance` prints both, to the office
-- that owns them, and the provider gets neither.
--
-- Two bits: *proof on record*, *declaration on record*. Nothing behind either.
--
-- ## ⛔ WHAT IS STILL NOT EXPOSED, AND REGISTER ENTRY 97 IS UNCHANGED BY THIS
--
-- NOT the decision reference. NOT the basis. NOT the effective date. NOT the suspended-until date.
-- NOT the letter. NOT the kind of act. A sanction's contents are the OFFICE'S (decision 92), the
-- owner closed entry 97 on exactly that, and this migration moves none of it. The banned-name
-- assertion below is carried over verbatim and the two new names are not on it, because they are
-- not regulatory detail.
--
-- ⚠️ SO THE PROVIDER'S DERIVED STANDING STILL CANNOT SEE AN ACT, and one state is therefore
-- invisible to it: `ENDED_BY_ACT` — a deficiency notice or a renewal refusal ending the
-- under-study state — reads on the provider screen as `RENEWAL_PENDING` where the office's own
-- screen reads EXPIRED. That is register entry 97's declared limit reaching one more state rather
-- than a new hole, `mayNotIssue` is the one bit the owner DID grant for the act half, and
-- `provider-office-state.service.ts` names the limit where it derives. It is reported, not fixed:
-- widening it is the same cross-office disclosure decision the owner has already ruled on once.
--
-- ## IT IS STILL NOT DERIVED IN SQL — AND THAT IS THE POINT OF SHIPPING RAW BITS
--
-- `ProviderOfficeState`'s header has said since module 0 item (j) that the lapse rule is NOT
-- reimplemented in SQL, because a copy of a rule whose check order is load-bearing is a second
-- answer to it. These two columns are RAW PRESENCE TESTS over two licence columns — `IS NOT NULL`
-- and a trimmed-empty test — and carry no part of decision 128's four conditions. The service
-- applies the shared `deriveLicenseStanding` to them, so the provider screen and the licence
-- screen now run the SAME function over the same facts.
--
-- ⟶ And that DELETES a derivation rather than adding one: the provider service's call to
--   `isBrokerLicenseCurrentlyLapsed` is gone, which is the function `license-standing.config.ts`
--   forbids reinstating in a standing derivation in its own words.

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
    -- THE TWO NEW FACTS, as BITS. The document id and the Central Bank's reference number are
    -- read here and never selected: what leaves this CTE is whether each is present.
    (bl."renewalProofDocumentId" IS NOT NULL)                       AS "renewalProofOnRecord",
    (COALESCE(TRIM(bl."renewalReferenceNumber"), '') <> '')         AS "renewalReferenceOnRecord"
  FROM "BrokerLicense" bl
  ORDER BY bl."organizationId", bl."expiresAt" DESC, bl."id" DESC
),
-- WHETHER ANYBODY DECLARED, AND NOTHING ABOUT WHO. `LicenseRenewalDeclaration` is 1-1 with the
-- term by a UNIQUE on `brokerLicenseId`, so this is an existence test on one row. `actorNameShown`
-- and `declaredAt` are deliberately not selected — see the header.
renewal_declaration AS (
  SELECT ct."organizationId", TRUE AS "renewalDeclarationOnRecord"
  FROM current_term ct
  JOIN "LicenseRenewalDeclaration" d ON d."brokerLicenseId" = ct."termId"
),
-- THE STANDING ACT PER OFFICE, by the same total order the api folds on. One row per organization:
-- the LAST act in that order, whatever its kind. UNCHANGED from the previous version of this view.
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
  -- FALSE rather than NULL for an office with no term, matching `mayNotIssue`'s own reasoning
  -- below: "no proof has been filed" is a definite answer where there is nothing to file against,
  -- and the service reads these only when a term exists.
  COALESCE(ct."renewalProofOnRecord", FALSE)     AS "renewalProofOnRecord",
  COALESCE(ct."renewalReferenceOnRecord", FALSE) AS "renewalReferenceOnRecord",
  COALESCE(rd."renewalDeclarationOnRecord", FALSE) AS "renewalDeclarationOnRecord",
  -- A suspension or a cancellation standing today bars new issuance; a reinstatement (or no act at
  -- all) does not. FALSE rather than NULL for an office with no acts, because "no regulator has
  -- barred this office" is a definite answer and a null would make a reader guess whether it means
  -- unknown.
  ((sa."kind" IN ('SUSPENSION', 'CANCELLATION')) IS TRUE) AS "mayNotIssue",
  COALESCE(sc."licensedBranches", 0)             AS "licensedBranches",
  COALESCE(sc."dormantLicensedBranches", 0)      AS "dormantLicensedBranches",
  COALESCE(uc."users", 0)                        AS "users",
  COALESCE(uc."activeUsers", 0)                  AS "activeUsers",
  la."lastActivityAt"
FROM "Organization" o
LEFT JOIN current_term ct ON ct."organizationId" = o."id"
LEFT JOIN renewal_declaration rd ON rd."organizationId" = o."id"
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
  missing TEXT;
BEGIN
  SELECT count(*) INTO view_cols
  FROM information_schema.columns WHERE table_name = 'ProviderOfficeState';
  IF view_cols <> 21 THEN
    RAISE EXCEPTION 'the provider view should carry 21 columns — 18 plus the three renewal bits — found %', view_cols;
  END IF;

  -- THE THREE NEW BITS, BY NAME. Asserted positively as well as the ban below, because the whole
  -- point of this migration is that the service can now tell four renewal states apart, and it
  -- silently cannot if any one of them is absent.
  SELECT string_agg(needed, ', ') INTO missing
  FROM unnest(ARRAY['renewalProofOnRecord', 'renewalReferenceOnRecord', 'renewalDeclarationOnRecord']) AS needed
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProviderOfficeState' AND column_name = needed
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'the renewal bits the provider standing needs are missing: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProviderOfficeState' AND column_name = 'mayNotIssue'
  ) THEN
    RAISE EXCEPTION 'the one regulatory fact is missing';
  END IF;

  -- AND NOTHING BEHIND IT. Asserted BY NAME, in the migration, because this is the boundary and a
  -- later `CREATE OR REPLACE` adding "just the decision reference" is exactly the change that needs
  -- to fail here rather than in review.
  --
  -- WIDENED BY FOUR NAMES with this migration, and they are the ones THIS change could plausibly
  -- have reached for and did not: the proof document, the Central Bank's reference number, and the
  -- declaring employee's name and date. Three bits say whether each exists; none of them says what
  -- it is or who they are.
  SELECT string_agg(column_name, ', ') INTO leaked
  FROM information_schema.columns
  WHERE table_name = 'ProviderOfficeState'
    AND column_name IN (
      'decisionRef', 'regulatoryDecisionRef', 'basis', 'regulatoryBasis',
      'effectiveFrom', 'suspendedUntil', 'documentId', 'kind', 'regulatoryActionKind',
      'standingActDecisionRef', 'licenseStatus',
      'renewalProofDocumentId', 'renewalReferenceNumber',
      'actorNameShown', 'declaredAt'
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

  RAISE NOTICE 'the provider view carries % columns including the three renewal bits, nothing behind them, security_invoker %', view_cols, invoker;
END $$;
