-- MODULE 0-ب ITEM (c) — the eight provider-maintained reference tables, and two enums.
--
-- ============================================================================================
-- WHY EIGHT TABLES AND TWO ENUMS, AND NOT TEN OF EITHER
-- ============================================================================================
-- The owner's test, and it is NOT "closed set versus open set":
--
--   Does any code path BRANCH on the value? If the code branches on it, it stays an enum, because
--   a new row would create a state no code path handles — and that failure is silent. If the code
--   only displays, stores and filters it, it becomes a seeded table, because it will grow without
--   us and every growth must not require a release.
--
-- Measured against that test before writing a line. Nothing in this repository branches on a bank,
-- a city, a country, a currency, a licensing authority, a rating agency, a legal form or a business
-- model — they are stored, shown and filtered. A new bank opens in Jordan and nobody waits for a
-- deploy.
--
-- `BrokerageKind` and `IntegrationMethod` are the opposite: both decide what the code DOES.
-- Instructions No. 9 of 2026 govern insurance brokerage, so a REINSURANCE broker must not have the
-- art. 4/a capital slabs or the art. 4/z staffing minimums applied to it; and API / portal / email
-- / manual are four different integration paths with `api_endpoint` required for exactly one.
--
-- Record status is NOT added — `OrgStatus` already exists and is reused. A second status enum
-- would be two homes for one fact.
--
-- ============================================================================================
-- PLATFORM-SCOPED, AND THE MIGRATION PROVES IT RATHER THAN ASSERTING IT IN A COMMENT
-- ============================================================================================
-- None of the eight carries `organizationId`, so none is in `TENANT_SCOPED_MODELS` (which is
-- derived from the DMMF by exactly that column) and none gets an RLS policy. An office adds no
-- bank and no city.
--
-- That is the whole difference from `OfficeInsuranceLine`, where an office's own vocabulary
-- genuinely is its own. Getting it wrong in the other direction would be worse than it looks: a
-- reference table carrying `organizationId` would be invisible to every office but the one that
-- seeded it, and the symptom would be an empty picker rather than an error.
--
-- The DO block below asserts the absence of that column on all eight, because a later migration
-- adding it would silently convert a shared catalogue into a per-office one.
--
-- ============================================================================================
-- THE SHAPE IS `InsuranceLine`'S
-- ============================================================================================
-- `code` UNIQUE, both scripts, `displayOrder`. Seeded by `seed.ts` upserting on `code` — never on
-- the uuid, because each database generates its own ids and a re-seed has to recognise a row by
-- the one value stable across all of them.
--
-- Both scripts are REQUIRED, not optional. This system's base language is Arabic; a reference row
-- that exists only in Latin script shows up untranslated mid-sentence on an Arabic page, which is
-- the same reason `Role` and a locally registered `Insurer` both require the pair.

CREATE TYPE "BrokerageKind" AS ENUM ('DIRECT', 'REINSURANCE');
CREATE TYPE "IntegrationMethod" AS ENUM ('API', 'PORTAL', 'EMAIL', 'MANUAL');

CREATE TABLE "Country" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

CREATE TABLE "City" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

CREATE TABLE "Bank" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Bank_code_key" ON "Bank"("code");

CREATE TABLE "Currency" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

CREATE TABLE "LicensingAuthority" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LicensingAuthority_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LicensingAuthority_code_key" ON "LicensingAuthority"("code");

CREATE TABLE "RatingAgency" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RatingAgency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RatingAgency_code_key" ON "RatingAgency"("code");

CREATE TABLE "LegalForm" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalForm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalForm_code_key" ON "LegalForm"("code");

CREATE TABLE "BusinessModel" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "nameAr"       TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessModel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessModel_code_key" ON "BusinessModel"("code");

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  t         TEXT;
  tables    TEXT[] := ARRAY['Country','City','Bank','Currency','LicensingAuthority',
                            'RatingAgency','LegalForm','BusinessModel'];
  n         INTEGER;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- 1. The table exists.
    SELECT count(*) INTO n FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE c.relname = t AND ns.nspname = current_schema() AND c.relkind = 'r';
    IF n <> 1 THEN
      RAISE EXCEPTION 'reference tables: % was not created', t;
    END IF;

    -- 2. PLATFORM-SCOPED. No `organizationId`, which is what keeps it out of the DMMF-derived
    --    TENANT_SCOPED_MODELS set. A later migration adding that column would silently turn a
    --    shared catalogue into a per-office one, and the symptom would be an EMPTY PICKER for
    --    every office but the one that seeded it — not an error.
    SELECT count(*) INTO n FROM pg_attribute
     WHERE attrelid = format('%I', t)::regclass
       AND attname = 'organizationId' AND attnum > 0 AND NOT attisdropped;
    IF n <> 0 THEN
      RAISE EXCEPTION 'reference tables: % carries organizationId — it must be platform-scoped', t;
    END IF;

    -- 3. No RLS. These are read by every office; a policy here would hide the catalogue from
    --    everyone, because `app.current_org_id` is never set for a model the extension does not
    --    scope — the exact outage shape Phase 1 of the RBAC rework hit.
    SELECT count(*) INTO n FROM pg_class
     WHERE relname = t AND relrowsecurity;
    IF n <> 0 THEN
      RAISE EXCEPTION 'reference tables: % has row-level security enabled', t;
    END IF;

    -- 4. BOTH SCRIPTS REQUIRED. An Arabic-first system must not be able to hold a reference row
    --    that can only be printed in Latin script.
    SELECT count(*) INTO n FROM pg_attribute
     WHERE attrelid = format('%I', t)::regclass
       AND attname IN ('nameEn', 'nameAr') AND attnotnull AND attnum > 0 AND NOT attisdropped;
    IF n <> 2 THEN
      RAISE EXCEPTION 'reference tables: % does not require BOTH nameEn and nameAr (found % NOT NULL)', t, n;
    END IF;

    -- 5. `code` is unique — the seed upserts on it, so without this a re-seed would duplicate
    --    every row instead of updating it.
    SELECT count(*) INTO n FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = format('%I', t)::regclass AND i.indisunique AND a.attname = 'code';
    IF n < 1 THEN
      RAISE EXCEPTION 'reference tables: % has no unique index on code', t;
    END IF;
  END LOOP;

  -- 6. The two enums carry exactly their intended values. A third label is a state nobody decided
  --    on — the same reason `OrganizationType` asserts its own set.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
   WHERE ty.typname = 'BrokerageKind';
  IF n <> 2 THEN
    RAISE EXCEPTION 'BrokerageKind: expected exactly DIRECT, REINSURANCE — found % value(s)', n;
  END IF;
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
   WHERE ty.typname = 'IntegrationMethod';
  IF n <> 4 THEN
    RAISE EXCEPTION 'IntegrationMethod: expected exactly API, PORTAL, EMAIL, MANUAL — found % value(s)', n;
  END IF;

  RAISE NOTICE 'reference tables: 8 created, all platform-scoped, both scripts required, code unique; 2 enums added.';
END $$;
