-- MODULE 0-ب ITEM (e), CORRECTION — `InsurerLicensedLine` WAS TENANT-SCOPED AND SHOULD NOT HAVE BEEN,
-- AND `Organization` GAINS THE MIRROR CHECK ITEM (b) ALREADY ESTABLISHED THE SHAPE FOR.
--
-- ============================================================================================
-- PART 1 — THE LICENSED LINES ARE A COMPANY FACT, NOT A TENANT'S ROW
-- ============================================================================================
--
-- ## WHAT WAS MEASURED, BOTH DATABASES
--
--   RLS enabled=true forced=true, one policy on app.current_org_id
--   columns: id, organizationId, insuranceLineId, createdAt
--   in the DMMF-derived tenant-scoped set: true (set size 135)
--   rows: 0
--
-- So the standing rule item (d) earned WAS applied — the policy landed with the table. The defect is
-- a level up: the table should never have been in that set at all.
--
-- ## WHY `organizationId` WAS THE WRONG COLUMN NAME, AND WHY A RENAME IS NOT COSMETIC
--
-- In this codebase `organizationId` does not mean "an organization" — it means THE TENANT THAT OWNS
-- THIS ROW. `tenantScopeExtension` derives its scoped set from the DMMF as "every model carrying an
-- organizationId", so the name alone decided that these rows are filtered to one tenant.
--
-- The tenant it filtered to was the INSURANCE COMPANY ITSELF. The consequences, all three real:
--
--   * a brokerage office could not read which lines a company is licensed to underwrite — the one
--     question the fact exists to answer;
--   * the PROVIDER, which writes these rows at registration, could not read them back. That is the
--     unreachable-capability shape this repository has measured 33 times, built in fresh;
--   * and it is the wrong SHAPE for the fact. The dictionary places licensed lines in the company's
--     "licensing and activity" group: it is a regulatory fact ABOUT THE COMPANY, granted by the
--     Central Bank, not an office's observation. One copy, or three offices dealing with the same
--     company keep three that can disagree — which is the problem decision 63's resolver exists to
--     prevent, reintroduced one table over.
--
-- ## THE SHAPE IT SHOULD HAVE HAD: GLOBAL, AND WRITABLE ONLY THROUGH ONE GATED PATH
--
-- `permissions.ts`'s own header states the principle and names `InsuranceLine` as its reference case:
-- when a shared resource has to be readable by every office, make it UNWRITABLE by an office rather
-- than writable behind a strict code. This table is one step weaker and the difference is stated
-- rather than glossed: it IS writable, by the provider's registration path, gated on a PLATFORM-scoped
-- code no office can hold. No office writes it, every office reads it.
--
-- `insuranceCompanyId` references `Organization(id)` and is deliberately NOT called `organizationId`.
-- The name is the mechanism.
--
-- ## DROP AND RECREATE, BECAUSE IT IS EMPTY — MEASURED, 0 ROWS ON BOTH DATABASES
--
-- A rename would leave the policy and the flags to be unwound separately and would read, in the
-- history, as a smaller change than it is. Dropping an empty table modifies no data, which is this
-- item's delivery evidence.

DROP TABLE "InsurerLicensedLine";

CREATE TABLE "InsurerLicensedLine" (
  "id"                TEXT NOT NULL,
  -- The INSURANCE COMPANY this licence fact is about. NOT `organizationId`: that name puts a model in
  -- `TENANT_SCOPED_MODELS` and filters it to one tenant, which is exactly what went wrong.
  "insuranceCompanyId" TEXT NOT NULL,
  "insuranceLineId"    TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsurerLicensedLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsurerLicensedLine_one_line_per_company"
  ON "InsurerLicensedLine"("insuranceCompanyId", "insuranceLineId");
CREATE INDEX "InsurerLicensedLine_insuranceCompanyId_idx"
  ON "InsurerLicensedLine"("insuranceCompanyId");

ALTER TABLE "InsurerLicensedLine" ADD CONSTRAINT "InsurerLicensedLine_insuranceCompanyId_fkey"
  FOREIGN KEY ("insuranceCompanyId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerLicensedLine" ADD CONSTRAINT "InsurerLicensedLine_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NO ROW-LEVEL SECURITY, AND THAT IS THE POINT RATHER THAN AN OMISSION. A global table carrying no
-- `organizationId` is not in the scoped set, so a policy on it would read a session variable the
-- extension never sets for it — a policy nothing can satisfy, which once made every permission read
-- return empty and 403'd every user everywhere. The eight reference tables are built the same way and
-- their own migration asserts it; assertion (3) below asserts it here.

-- ============================================================================================
-- PART 2 — THE MIRROR CHECK: AN INSURER'S LICENCE CERTIFICATE BELONGS TO AN INSURANCE COMPANY
-- ============================================================================================
--
-- Item (b) established the shape: `Organization_broker_kind_matches_type` requires `brokerKind` to be
-- NULL exactly when the organization is an `INSURANCE_COMPANY`, and it was written in BOTH directions
-- deliberately — a one-sided constraint would have missed "broker kind: CORPORATE on an insurer",
-- which is a value nothing reads, and a value nothing reads is a value somebody eventually reads.
--
-- `insurerLicenseCertificateDocumentId` had no such mirror. Without it a BROKERAGE OFFICE can carry an
-- insurer's licence certificate, and the single inspection query that justified giving
-- `INSURER_LICENSE_CERTIFICATE` its own `DocumentCategory` value would then return a wrong set —
-- wasting the separation rather than merely failing to complete it.
--
-- ONE-SIDED HERE, UNLIKE ITEM (b)'s, AND THE ASYMMETRY IS DELIBERATE. An insurance company MAY have no
-- certificate on record: the column is nullable because three organizations predate it and the
-- requirement lives at the write path. So the rule is "only an insurance company may carry one", not
-- "an insurance company must".
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_insurer_certificate_only_on_a_company"
  CHECK ("insurerLicenseCertificateDocumentId" IS NULL OR "type" = 'INSURANCE_COMPANY');

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  enabled BOOLEAN;
  org     TEXT;
  doc     TEXT;
BEGIN
  -- (1) The composite tenant foreign keys are all still there.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) THE COLUMN IS GONE BY NAME. `organizationId` is what puts a model in the DMMF-derived scoped
  --     set, so its absence is the mechanism and not a cosmetic detail.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"InsurerLicensedLine"'::regclass AND attname = 'organizationId'
     AND attnum > 0 AND NOT attisdropped;
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine still carries organizationId — it would be tenant-scoped to the insurance company and unreadable by every office';
  END IF;

  -- (3) NO RLS, AND NO POLICY. The opposite assertion from item (d)'s and equally explicit: a policy
  --     here would read a session variable nothing sets for this table.
  SELECT c.relrowsecurity INTO enabled FROM pg_class c WHERE c.oid = '"InsurerLicensedLine"'::regclass;
  IF enabled IS TRUE THEN
    RAISE EXCEPTION 'InsurerLicensedLine has row-level security enabled, but carries no organizationId — the policy could never be satisfied';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'InsurerLicensedLine';
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine carries % policy/policies and is not tenant-scoped', n;
  END IF;

  -- (4) STILL NO REACH INTO `BrokerLicense`. The reason this table exists rather than reusing
  --     `BrokerLicenseScopeLine`: a foreign key there starts the life/general derivation answering
  --     for an entity that holds no broker licence.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"InsurerLicensedLine"'::regclass AND contype = 'f'
     AND confrelid = '"BrokerLicense"'::regclass;
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine references BrokerLicense — an insurance company would be derived as a life/general BROKER';
  END IF;

  -- (5) THE MIRROR CHECK REFUSES, PROVEN BY ATTEMPTING IT rather than by reading `pg_constraint`. A
  --     predicate loosened to `TRUE OR (...)` still names both columns and refuses nothing, which
  --     this module has already caught once.
  SELECT id INTO doc FROM "Document" LIMIT 1;
  SELECT id INTO org FROM "Organization" WHERE "type" = 'BROKERAGE_OFFICE' LIMIT 1;
  IF doc IS NOT NULL AND org IS NOT NULL THEN
    BEGIN
      UPDATE "Organization" SET "insurerLicenseCertificateDocumentId" = doc WHERE id = org;
      RAISE EXCEPTION 'a BROKERAGE OFFICE accepted an insurer licence certificate — the CHECK refuses nothing';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END IF;

  -- (6) ZERO ROWS MODIFIED. The table was empty before this migration and is empty after it; nothing
  --     else is written. Item (e)'s delivery evidence, asserted by the migration most able to break it.
  SELECT count(*) INTO n FROM "InsurerLicensedLine";
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine holds % row(s) — this migration creates the table and populates nothing', n;
  END IF;
  SELECT count(*) INTO n FROM "Organization" WHERE "insurerLicenseCertificateDocumentId" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Organization row(s) carry a certificate id — nothing here writes one', n;
  END IF;

  RAISE NOTICE 'InsurerLicensedLine is a company fact: no organizationId, no RLS, no reach into BrokerLicense; the insurer certificate is refused on a brokerage office';
END $$;
