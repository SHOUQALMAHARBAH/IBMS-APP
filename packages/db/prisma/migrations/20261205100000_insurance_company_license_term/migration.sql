-- MODULE 0-ب CLOSE, batch 5 group 7d — THE INSURANCE COMPANY'S LICENCE TERM.
--
-- ## WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT
--
-- A SERIES of terms, each with its licence number, its issue date and its expiry — so the company's
-- licence STANDING can be derived. There is no status column and there must not be one: the
-- registration DTO already records that decision (#12, decision 71 and the dictionary's correction
-- 3, «حالة الترخيص لا تُخزَّن»), and 7d agrees with it exactly.
--
-- ## IT SUPERSEDES TWO RECORDED NOTES, QUOTED RATHER THAN OVERWRITTEN
--
-- `schema.prisma` and `register-insurance-company.dto.ts` both said there was no term to model,
-- because "the v2 insurer sheet carries no issue or expiry date, unlike the broker sheet". That
-- reason was sound and the premise has moved: the owner wants the dates, because without an expiry
-- no standing can be derived at all. The consequence is that the REGISTRATION FORM collects them —
-- otherwise these columns would be unpopulatable by any path, which is the
-- capability-nobody-can-exercise class this module has measured twice. Both notes are corrected
-- where they sit.
--
-- ## NO `organizationId`, AND THAT IS THE ESTABLISHED SHAPE FOR A COMPANY-LEVEL FACT
--
-- `InsurerLicensedLine` is the precedent and its own comment states the rule: the company is named
-- EXPLICITLY, there is no `@default(dbgenerated())`, "because nothing scopes this table and nothing
-- should". A licence term is a fact ABOUT the company rather than a row belonging to a tenant — the
-- provider that registered it and the company reading its own record are both legitimate readers,
-- and a tenant-scoped row would hide it from one of them. So no RLS either, for the same reason that
-- table has none.
--
-- ## NO CERTIFICATE COLUMN HERE
--
-- The company's licence certificate already lives on `Organization.insurerLicenseCertificateDocumentId`.
-- A per-term certificate would be a second home for one fact, and moving the existing one is not in
-- 7d's brief. Unlike `BrokerLicense.certificateDocumentId`, which is NOT NULL, nothing here requires
-- one — that column was discovered rather than chosen, and its own note says not to reason from it.
--
-- ## AND NO `renewalRequestedAt`
--
-- That column exists on the broker's term because art. 11 gives a broker a 45-day filing deadline
-- and a by-operation-of-law extension. Nothing in this product establishes that art. 11 governs an
-- insurance company, so a column for it would be a structure asserting a regulatory reading nobody
-- has made.

CREATE TABLE "InsuranceCompanyLicenseTerm" (
  "id" TEXT NOT NULL,

  -- Named EXPLICITLY, the `InsurerLicensedLine` shape: no tenancy default, because nothing scopes
  -- this table and nothing should.
  "insuranceCompanyId" TEXT NOT NULL,

  "licenseNumber" TEXT NOT NULL,
  -- NULLABLE: a company may know its expiry and not its issue date, and refusing the term over a
  -- date the certificate may not print would lose the expiry too — which is the only date the
  -- standing needs. `BrokerLicense.issuedAt` is nullable for the same reason.
  "issuedAt" TIMESTAMP(3),
  -- NOT NULL. This is the one column the derivation cannot do without: a term with no expiry cannot
  -- produce CURRENT or EXPIRED, so it would be a row that looks like a term and answers nothing.
  "expiresAt" TIMESTAMP(3) NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InsuranceCompanyLicenseTerm_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InsuranceCompanyLicenseTerm"
  ADD CONSTRAINT "InsuranceCompanyLicenseTerm_insuranceCompanyId_fkey"
  FOREIGN KEY ("insuranceCompanyId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- THE SAME TERM TWICE IS REFUSED, and an ordinary compound unique is correct here rather than the
-- two-partial-index shape its broker sibling needs: all three columns in the key are NOT NULL, so
-- there is nothing nullable for Postgres to treat as distinct and the NULL-distinctness trap cannot
-- apply. `InsurerLicensedLine` states the same distinction for the same reason.
ALTER TABLE "InsuranceCompanyLicenseTerm"
  ADD CONSTRAINT "InsuranceCompanyLicenseTerm_one_term_per_number_and_expiry"
  UNIQUE ("insuranceCompanyId", "licenseNumber", "expiresAt");

CREATE INDEX "InsuranceCompanyLicenseTerm_insuranceCompanyId_idx"
  ON "InsuranceCompanyLicenseTerm"("insuranceCompanyId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "InsuranceCompanyLicenseTerm" TO ibms_app;

DO $$
DECLARE
  cols TEXT;
  rls RECORD;
BEGIN
  -- THERE MUST BE NO STATUS COLUMN. The registration DTO records that decision and the dictionary
  -- states it in Arabic; this is the form of it that a future migration cannot quietly undo.
  -- Asserted by NAME SHAPE rather than by one spelling, so `status`, `licenseStatus` and
  -- `licenseStatusId` are all refused.
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO cols
  FROM pg_attribute
  WHERE attrelid = 'public."InsuranceCompanyLicenseTerm"'::regclass
    AND attnum > 0 AND NOT attisdropped;
  IF cols ~* 'status' THEN
    RAISE EXCEPTION 'the licence STANDING is DERIVED and must have no column — found % ', cols;
  END IF;

  -- AND NO TENANCY DEFAULT, which is what makes this a company-level fact rather than a tenant row.
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public."InsuranceCompanyLicenseTerm"'::regclass
      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%app.current_org_id%'
  ) THEN
    RAISE EXCEPTION 'this table must carry NO tenancy default — a licence term is a fact about the company, and scoping it would hide it from the provider that registered it';
  END IF;

  -- RLS is deliberately NOT enabled, the `InsurerLicensedLine` precedent. Asserted so that enabling
  -- it later is a decision somebody makes against this sentence rather than by habit: with no
  -- `organizationId` column the extension sets no `app.current_org_id` for this model, so a policy
  -- here would match NOTHING and the table would read empty for everyone — the outage shape
  -- `tenant-scope.extension.spec.ts` exists to prevent.
  SELECT relrowsecurity, relforcerowsecurity INTO rls
  FROM pg_class WHERE oid = 'public."InsuranceCompanyLicenseTerm"'::regclass;
  IF rls.relrowsecurity OR rls.relforcerowsecurity THEN
    RAISE EXCEPTION 'RLS must be OFF on a table carrying no organizationId — a policy here would match nothing and the table would read empty for everyone';
  END IF;

  RAISE NOTICE 'insurance company licence term: a series, no status column, no tenancy default, RLS off by design';
END $$;
