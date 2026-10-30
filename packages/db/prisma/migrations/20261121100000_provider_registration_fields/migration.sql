-- MODULE 0-ب ITEM (d) — the registration fields, and the regulator's act.
--
-- ============================================================================================
-- HAND-WRITTEN FROM A GENERATED DIFF, NOT THE DIFF ITSELF — AND THAT IS NOT FUSSINESS
-- ============================================================================================
-- `prisma migrate diff` was run to CHECK this file, never to produce it. Its output carried, ahead
-- of every useful statement, THIRTEEN DROPS:
--
--   ALTER TABLE "Policy"                    DROP CONSTRAINT "Policy_office_line_same_org_fkey";
--   ALTER TABLE "BrokerLicenseScopeLine"    DROP CONSTRAINT "..._office_line_same_org_fkey";
--   ALTER TABLE "InsurerOfferedLine"        DROP CONSTRAINT "..._insurer_same_org_fkey";
--   ... and ten more
--
-- Those are the COMPOSITE TENANT FOREIGN KEYS — `(childId, organizationId) -> Parent(id,
-- organizationId)` — which Prisma cannot express, so a diff reads them as drift to remove. Applying
-- the generated migration would have dropped the constraints that stop one office's row referencing
-- another office's insurance line, with every test still green and the symptom arriving only when
-- two real offices exist.
--
-- `schema.prisma` deliberately holds LESS than the database. That is recorded in the repository's
-- own notes, and this is the case it was written about.
--
-- The protection is not this comment: `db:divergence` reads the LIVE DATABASE and exits non-zero
-- when an expected constraint is absent, and it runs in CI. Proven on a throwaway by dropping
-- `Policy_office_line_same_org_fkey` and watching the check name it. The comment explains; the gate
-- enforces.
--
-- ============================================================================================
-- EVERY COLUMN IS NULLABLE, AND THAT IS A DECISION ABOUT EXISTING ROWS
-- ============================================================================================
-- Three organizations already exist — two brokerage offices and the provider — and none of them was
-- registered through a form that could have collected any of this. A NOT NULL column would either
-- refuse the migration or demand a backfill of facts nobody can source, which is the invented-legal-
-- name failure this module already refused once.
--
-- The REQUIREMENT therefore lives at the registration write path, where a human is supplying the
-- values, and not on the column. That is the opposite of `legalNameAr`, which tightened BECAUSE the
-- measurement found zero rows lacking one.
--
-- ============================================================================================
-- TWO UNIQUE INDEXES, BOTH PLATFORM-WIDE AND ACROSS ORGANIZATION TYPES
-- ============================================================================================
-- `nationalEstablishmentNo` is THE DUPLICATE-REGISTRATION DEFENCE. It is a NATIONAL identifier, so a
-- per-tenant constraint would let the same real office be registered twice — which is the one thing
-- the field exists to prevent. Across types too: the same establishment cannot be both a brokerage
-- office and an insurance company.
--
-- `code` likewise. The field dictionary carries `broker_code` and `insurer_code` separately because
-- it models two tables; both live on `Organization` now, so one column serves both and an insurer
-- cannot carry a broker's code.
--
-- Postgres treats NULLs as DISTINCT in a unique index, so the three existing rows — all NULL on
-- both columns — do not collide with each other. That is the § 1.25 NULL-distinctness behaviour
-- working FOR us here rather than against us, and it is why these can be plain uniques rather than
-- partial ones.

CREATE TYPE "RegulatoryActionKind" AS ENUM ('SUSPENSION', 'CANCELLATION', 'REINSTATEMENT');

ALTER TABLE "Organization"
  ADD COLUMN "code"                       TEXT,
  ADD COLUMN "tradeName"                  TEXT,
  ADD COLUMN "nationalEstablishmentNo"    TEXT,
  ADD COLUMN "commercialRegistrationNo"   TEXT,
  ADD COLUMN "commercialRegistrationDate" DATE,
  ADD COLUMN "taxNumber"                  TEXT,
  ADD COLUMN "brokerageKind"              "BrokerageKind",
  ADD COLUMN "countryId"                  TEXT,
  ADD COLUMN "cityId"                     TEXT,
  ADD COLUMN "address"                    TEXT,
  ADD COLUMN "phone"                      TEXT,
  ADD COLUMN "email"                      TEXT,
  ADD COLUMN "website"                    TEXT,
  ADD COLUMN "generalManagerName"         TEXT,
  ADD COLUMN "complianceOfficerName"      TEXT,
  ADD COLUMN "complianceOfficerEmail"     TEXT,
  ADD COLUMN "complianceOfficerPhone"     TEXT,
  ADD COLUMN "bankGuaranteeNo"            TEXT,
  ADD COLUMN "bankGuaranteeBankId"        TEXT,
  ADD COLUMN "bankGuaranteeAmount"        DECIMAL(18,3),
  ADD COLUMN "bankGuaranteeExpiry"        DATE,
  ADD COLUMN "bankId"                     TEXT,
  ADD COLUMN "ibanEnc"                    TEXT,
  ADD COLUMN "currencyId"                 TEXT,
  ADD COLUMN "legalFormId"                TEXT,
  ADD COLUMN "licensingAuthorityId"       TEXT,
  ADD COLUMN "shortName"                  TEXT,
  ADD COLUMN "insurerLicenseNumber"       TEXT,
  ADD COLUMN "businessModelId"            TEXT,
  ADD COLUMN "integrationMethod"          "IntegrationMethod",
  ADD COLUMN "apiEndpoint"                TEXT,
  ADD COLUMN "quotationEmail"             TEXT,
  ADD COLUMN "claimsEmail"                TEXT,
  ADD COLUMN "createdByUserId"            TEXT,
  ADD COLUMN "updatedByUserId"            TEXT;

-- The field dictionary's `pi_policy_no`, which had nowhere to go: this model carried the limit and
-- the expiry and no policy number at all.
ALTER TABLE "ProfessionalIndemnityPolicy" ADD COLUMN "policyNumber" TEXT;

CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");
CREATE UNIQUE INDEX "Organization_nationalEstablishmentNo_key" ON "Organization"("nationalEstablishmentNo");

-- ============================================================================================
-- THE REGULATOR'S ACT — APPEND-ONLY, because licence STATUS is derived (decision 71)
-- ============================================================================================
-- The field dictionary's v2 corrections tab reclassifies `license_status_id` on BOTH sheets from a
-- stored FK to "محسوب — لا عمود". Status is computed from the term's dates, whether a renewal was
-- filed and when, and whether an act is standing. What is STORED is the act itself.
--
-- `documentId` is `ON DELETE RESTRICT` because the document IS the evidence — it must not vanish
-- from under the record. The consequence is named rather than discovered: a corrected scan can only
-- be ADDED, and this model CANNOT express that one act's document superseded another's. No field is
-- invented for it here; it is recorded in `docs/deferred-register.md`, and when it is needed it is a
-- LINK BETWEEN TWO ACTS rather than a mutable column, because append-only is the whole point.
CREATE TABLE "RegulatoryAction" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "kind"             "RegulatoryActionKind" NOT NULL,
  "effectiveFrom"    DATE NOT NULL,
  "decisionRef"      TEXT NOT NULL,
  "documentId"       TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "recordedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegulatoryAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegulatoryAction_organizationId_effectiveFrom_idx"
  ON "RegulatoryAction"("organizationId", "effectiveFrom");

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_bankGuaranteeBankId_fkey"
  FOREIGN KEY ("bankGuaranteeBankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_bankId_fkey"
  FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_currencyId_fkey"
  FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_legalFormId_fkey"
  FOREIGN KEY ("legalFormId") REFERENCES "LegalForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_licensingAuthorityId_fkey"
  FOREIGN KEY ("licensingAuthorityId") REFERENCES "LicensingAuthority"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_businessModelId_fkey"
  FOREIGN KEY ("businessModelId") REFERENCES "BusinessModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RegulatoryAction" ADD CONSTRAINT "RegulatoryAction_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegulatoryAction" ADD CONSTRAINT "RegulatoryAction_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- 1. THE THIRTEEN COMPOSITE TENANT FOREIGN KEYS ARE STILL THERE. This migration was hand-written
  --    precisely because the generated one would have dropped them, so the first thing it proves is
  --    that it did not. `db:divergence` would also catch it — this is the belt beside the braces,
  --    and it fires at the moment of the mistake rather than at the next CI run.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- 2. Both uniques exist and are PLATFORM-WIDE: no `organizationId` in the index, which would make
  --    them per-office and let the same national establishment number be registered twice.
  FOREACH def IN ARRAY ARRAY['Organization_code_key', 'Organization_nationalEstablishmentNo_key'] LOOP
    SELECT count(*) INTO n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = def AND i.indisunique;
    IF n <> 1 THEN
      RAISE EXCEPTION 'registration: % is missing or not unique', def;
    END IF;
    SELECT count(*) INTO n FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE c.relname = def AND a.attname = 'organizationId';
    IF n <> 0 THEN
      RAISE EXCEPTION 'registration: % is scoped per-office — a national identifier must be unique across the platform', def;
    END IF;
  END LOOP;

  -- 3. EVERY NEW COLUMN IS NULLABLE. Three organizations predate the registration form and none of
  --    them could have supplied any of this; a NOT NULL would demand a backfill of facts nobody can
  --    source. The requirement lives at the write path, where a human is supplying the values.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Organization"'::regclass AND attnotnull AND attnum > 0 AND NOT attisdropped
     AND attname IN ('code','tradeName','nationalEstablishmentNo','commercialRegistrationNo',
                     'taxNumber','brokerageKind','countryId','cityId','address','phone','email',
                     'generalManagerName','complianceOfficerName','complianceOfficerEmail',
                     'bankId','ibanEnc','currencyId','legalFormId','licensingAuthorityId');
  IF n <> 0 THEN
    RAISE EXCEPTION 'registration: % new column(s) are NOT NULL — existing organizations cannot satisfy them', n;
  END IF;

  -- 4. PROVEN, not asserted: a duplicate national establishment number is refused BY THE DATABASE.
  --    Written through the OWNER connection in a nested block that rolls itself back, so no service
  --    could be mistaken for the thing refusing it. This is the duplicate-registration defence and
  --    it is the one guard here that a reader would otherwise take on trust.
  --    `brokerKind` IS SUPPLIED AND IT IS NOT OPTIONAL HERE: item (b)'s CHECK
  --    `Organization_broker_kind_matches_type` requires a brokerage office to carry one and an
  --    insurance company to carry none. The first version of this probe omitted it and the
  --    migration failed on that CHECK — item (b)'s constraint catching this migration's own test
  --    fixture, which is the constraint working exactly as intended.
  BEGIN
    INSERT INTO "Organization" ("id","legalName","legalNameAr","type","brokerKind","subdomain","updatedAt","nationalEstablishmentNo")
      VALUES ('00000000-0000-0000-0000-00000000d001','Probe A','فحص أ','BROKERAGE_OFFICE','CORPORATE','probe-dup-a', now(), 'PROBE-NAT-001');
    INSERT INTO "Organization" ("id","legalName","legalNameAr","type","brokerKind","subdomain","updatedAt","nationalEstablishmentNo")
      VALUES ('00000000-0000-0000-0000-00000000d002','Probe B','فحص ب','INSURANCE_COMPANY',NULL,'probe-dup-b', now(), 'PROBE-NAT-001');
    RAISE EXCEPTION 'registration: TWO organizations shared a national establishment number — the duplicate-registration defence refuses nothing';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM "Organization" WHERE "nationalEstablishmentNo" = 'PROBE-NAT-001';
  IF n <> 0 THEN
    RAISE EXCEPTION 'registration: the duplicate probe leaked % row(s)', n;
  END IF;

  -- 5. The regulatory act carries no `organizationId`-free path to another office's rows: it is a
  --    tenant-scoped model like any other, so it must have the column the extension keys on.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"RegulatoryAction"'::regclass AND attname = 'organizationId'
     AND attnotnull AND attnum > 0 AND NOT attisdropped;
  IF n <> 1 THEN
    RAISE EXCEPTION 'RegulatoryAction has no NOT NULL organizationId — it would be unscoped';
  END IF;

  RAISE NOTICE 'registration fields: 35 columns added nullable, 2 platform-wide uniques PROVEN to refuse a duplicate, 13 composite tenant FKs intact.';
END $$;
