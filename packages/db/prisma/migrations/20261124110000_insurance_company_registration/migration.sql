-- MODULE 0-ب ITEM (e), PART 2 OF 2 — REGISTERING AN INSURANCE COMPANY.
--
-- ## THE MEASUREMENT THAT MADE THIS A SMALL MIGRATION
--
-- 27 of the 30 candidate columns on the v2 insurer sheet ALREADY EXIST on `Organization`: item (d)
-- added them for the broker and the two sheets share them (code, both legal names, short name, legal
-- form, national establishment number, CR, tax number, insurer licence number, licensing authority,
-- business model, country, city, address, phone, email, website, quotation and claims email,
-- integration method, API endpoint, bank, IBAN, currency, status, created/updated by). Measured
-- before anything was written, which is why this item is a service, a screen and a resolver rather
-- than a schema item.
--
-- Five placements remained. Each is below with where it landed and why.
--
-- ## 1-3. THE BROKER-RELATIONS TRIO GOES ON `Insurer`, NOT ON `Organization`
--
-- Owner's decision, and the schema already draws the line it rests on. `Insurer` carries
-- `rfqContactName/Email/Phone`, `claimsContactName/Email` and `underwriterContact` — office-scoped
-- NAMED HUMANS — beside `companyPhone`, `companyEmail` and `companyWebsite`, which are company facts.
--
-- The trio belongs with the first group: each brokerage office deals with a different named contact
-- inside the same insurance company, so a single column on the organization would hold ONE office's
-- contact and show it to every other office. The published channels (`quotation_email`,
-- `claims_email`) are company facts and stay on the organization behind the resolver; the named
-- human does not. The existing naming is followed rather than a third convention invented.
--
-- ## 4-5. THE RATING'S AGENCY AND ITS AS-OF DATE, ALSO ON `Insurer`
--
-- Decision 64: `financialStrengthRating` is OFFICE-scoped — it is the rating THIS office recorded in
-- performing its duty of care when choosing an insurer, not a public fact about the company. The
-- dictionary's correction 5 says why the date is required beside it: «تصنيفاً بلا تاريخٍ دعوى لا
-- سجلّ عناية» — a rating with no date is a claim, not a due-diligence record.
--
-- Measured: the rating column has existed since Process 31 and carried NEITHER its agency nor its
-- date. `RatingAgency` was seeded by item (c) and had no foreign key pointing at it from anywhere.
--
-- ## 6. THE COMPANY'S LICENSED LINES GET THEIR OWN LINK — `InsurerLicensedLine`
--
-- MEASURED BEFORE DECIDING, because the tempting reuse is the dangerous one.
-- `BrokerLicenseScopeLine."brokerLicenseId"` is `TEXT NOT NULL` referencing `BrokerLicense`, so
-- attaching a company's lines through it would require creating a BROKER LICENCE ROW FOR AN
-- INSURANCE COMPANY. The implication is structural, not an accident of derivation.
--
-- And it compounds twice over. `typesInScope` derives life/general LICENCE TYPES from those rows
-- (decision 67), so the system would report an insurance company as licensed as a life-and-general
-- BROKER — the same class as the provider once appearing as an office with no licence term. And
-- `BrokerLicenseScopeService` enforces art. 3/a against `Organization.brokerKind`, which item (b)'s
-- CHECK requires to be NULL for an `INSURANCE_COMPANY`: the company would trip a constraint on the
-- path where it did not get a wrong answer.
--
-- So the derivation keeps reading ONLY broker licence scope, and the company gets this table.
--
-- STANDARD CATALOGUE LINES ONLY, with no office-line column. The two-nullable-FK shape the four MUST
-- models carry exists because an OFFICE may add a line of its own; an insurance company's licence is
-- granted by the Central Bank against the Bank's own classification, and a line one brokerage office
-- invented is not something a regulator licensed anybody for. One required FK is the honest shape and
-- it makes the other unrepresentable rather than merely disallowed.
--
-- TENANT-SCOPED, WITH RLS, AND THE POLICY LANDS WITH THE TABLE. The organization here is the COMPANY
-- itself — an insurance company registered on this platform is a tenant. That means a brokerage
-- office cannot read these rows, which is correct and is also a gap: the provider writes them at
-- registration and has no route to read them back, and a broker who wants to know what a company may
-- lawfully underwrite has none either. Recorded in `docs/deferred-register.md` rather than solved by
-- inventing a view nobody asked for — and governed by the two-source rule recorded there, because
-- `InsurerDirectory.lines` already shows a DIFFERENT fact (what offices have actually bought) and the
-- two must never be reconciled into one list.
--
-- ## 7. THE LICENCE CERTIFICATE HANGS ON THE ORGANIZATION, NOT ON A TERM
--
-- The v2 insurer sheet has `license_no` and `licensing_authority_id` and NO issue or expiry date —
-- unlike the broker sheet, which has both and whose licence item (c) made a SERIES OF TERMS. So the
-- dictionary does not model an insurer's licence as a term series, and inventing one would be
-- building a structure for dates the form never collects.
--
-- `Organization.insurerLicenseNumber` already exists as a single column; the certificate sits beside
-- it. NULLABLE, because three organizations predate this and a NOT NULL would demand evidence nobody
-- can source — the same call item (d) made for all 35 of its columns, and the opposite of
-- `BrokerLicense.certificateDocumentId`, which is NOT NULL because that table was NEW.
-- The REQUIREMENT lives at the write path.

ALTER TABLE "Insurer"
  ADD COLUMN "brokerRelationsName"  TEXT,
  ADD COLUMN "brokerRelationsEmail" TEXT,
  ADD COLUMN "brokerRelationsPhone" TEXT,
  ADD COLUMN "ratingAgencyId"       TEXT,
  -- A DATE, not a timestamp: "as at" a day is what a rating carries, and storing a time would invite
  -- a reader to believe a precision the agency never published.
  ADD COLUMN "financialStrengthRatingAsOf" DATE;

ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_ratingAgencyId_fkey"
  FOREIGN KEY ("ratingAgencyId") REFERENCES "RatingAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A RATING AND ITS DATE TRAVEL TOGETHER. Correction 5's whole point: a rating with no date is a
-- claim rather than a due-diligence record. The CHECK makes the pair structural — a date may not
-- stand alone, and a rating may not be recorded without one — while leaving BOTH NULL as the
-- ordinary state of an insurer nobody has rated.
--
-- ## `NOT VALID`, AND THE MEASUREMENT THAT FORCED THE DECISION
--
-- The first version was an ordinary CHECK and the migration REFUSED TO APPLY:
-- `check constraint "Insurer_rating_carries_its_date" of relation "Insurer" is violated by some row`.
-- Of course it was — the date column did not exist until this statement, so EVERY rated insurer
-- carries a rating with no date by construction.
--
-- Measured rather than guessed at: dev holds 3 `Insurer` rows and all 3 are rated; db-test holds 618
-- and 3 are rated. They are the same three, they are seeded inside `SEED_SAMPLE_DATA`
-- (`NODE_ENV !== "production"`), and their values say so in the value itself — "A (sample rating)",
-- "A+ (sample rating)", "A- (sample rating)". A production database has none.
--
-- The two alternatives were both worse:
--
--   * BACKFILL A DATE — invents a fact nobody can source, which is the thing correction 5 exists to
--     prevent. Item (c) refused to stamp migrated CBJ approvals with the migration date for the same
--     reason, and item (d) made all 35 of its columns nullable on the same argument.
--   * CLEAR THE RATING on those three rows — honest about the data, but it MODIFIES ROWS, and this
--     item's delivery evidence is that it modifies none. A migration that edits three seed rows to
--     make its own constraint applicable is a migration that has quietly become a data migration.
--
-- `NOT VALID` means Postgres does not scan the existing rows. It does NOT mean the rule is advisory:
-- the constraint is enforced on every INSERT and every UPDATE from this statement onwards, which is
-- exactly "the rule applies going forward". Assertion (4) proves that by attempting both halves.
--
-- THE COST, STATED RATHER THAN DISCOVERED. Updating one of those three sample rows — even its phone
-- number — will now require the pair, because the constraint is checked against the new row version
-- and that version still violates. On dev and db-test that affects three fictional insurers; in
-- production it affects nothing, because the rows are sample-gated. Validating the constraint later
-- is a deliberate act (`VALIDATE CONSTRAINT`) and belongs with whoever decides what those three
-- ratings should say.
ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_rating_carries_its_date"
  CHECK (
    ("financialStrengthRating" IS NULL AND "financialStrengthRatingAsOf" IS NULL)
    OR ("financialStrengthRating" IS NOT NULL AND "financialStrengthRatingAsOf" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "Organization"
  ADD COLUMN "insurerLicenseCertificateDocumentId" TEXT;

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_insurerLicenseCertificateDocumentId_fkey"
  FOREIGN KEY ("insurerLicenseCertificateDocumentId") REFERENCES "Document"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InsurerLicensedLine" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "insuranceLineId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsurerLicensedLine_pkey" PRIMARY KEY ("id")
);

-- Once per company per line. BOTH columns are NOT NULL, so this is an ordinary compound unique and
-- NOT the two-partial-indexes shape its broker sibling needs: that one has two nullable line columns,
-- where Postgres treats NULLs as distinct and a compound unique would admit unlimited duplicates
-- (the § 1.25 trap). Here there is nothing nullable to be distinct.
CREATE UNIQUE INDEX "InsurerLicensedLine_one_line_per_company"
  ON "InsurerLicensedLine"("organizationId", "insuranceLineId");
CREATE INDEX "InsurerLicensedLine_organizationId_idx"
  ON "InsurerLicensedLine"("organizationId");

ALTER TABLE "InsurerLicensedLine" ADD CONSTRAINT "InsurerLicensedLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerLicensedLine" ADD CONSTRAINT "InsurerLicensedLine_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- THE POLICY LANDS WITH THE TABLE, NOT WITH ITS FIRST READER. Item (d) created one table and shipped
-- it without RLS; CI caught it, and the standing rule that came out of it is this. `ENABLE` alone
-- leaves the table OWNER exempt and every migration and the seed connect as the owner, so `FORCE` is
-- not ceremony.
ALTER TABLE "InsurerLicensedLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InsurerLicensedLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InsurerLicensedLine_tenant_isolation" ON "InsurerLicensedLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- ASSERTIONS — against the live database, in the migration, never asserted in prose.
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  enabled BOOLEAN;
  forced  BOOLEAN;
  org     TEXT;
  line    TEXT;
BEGIN
  -- (1) The composite tenant foreign keys are all still there. First assertion in every migration on
  --     this branch: a generated diff drops thirteen of them because Prisma cannot express them.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) RLS, BOTH FLAGS, AND A POLICY THAT READS THE SESSION VARIABLE. The three things item (d)'s
  --     table was missing. A policy that does not read `app.current_org_id` is one
  --     `tenantScopeExtension` can never satisfy — which once made every permission read return
  --     empty and 403'd every user everywhere.
  SELECT c.relrowsecurity, c.relforcerowsecurity INTO enabled, forced
    FROM pg_class c WHERE c.oid = '"InsurerLicensedLine"'::regclass;
  IF enabled IS NOT TRUE OR forced IS NOT TRUE THEN
    RAISE EXCEPTION 'InsurerLicensedLine: RLS enabled=% forced=% — both must be true', enabled, forced;
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'InsurerLicensedLine' AND qual LIKE '%app.current_org_id%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'InsurerLicensedLine: expected exactly one policy reading app.current_org_id, found %', n;
  END IF;

  -- (3) THE TABLE CANNOT REACH A BROKER LICENCE. The whole reason it exists rather than reusing
  --     `BrokerLicenseScopeLine`: if a foreign key to `BrokerLicense` ever appears here, the
  --     life/general derivation starts answering for an entity that holds no broker licence.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"InsurerLicensedLine"'::regclass AND contype = 'f'
     AND confrelid = '"BrokerLicense"'::regclass;
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine references BrokerLicense — an insurance company would be derived as a life/general BROKER';
  END IF;

  -- (4) THE RATING/DATE PAIR IS REFUSED IN BOTH DIRECTIONS, PROVEN BY ATTEMPTING IT rather than by
  --     reading `pg_constraint`. A predicate loosened to `TRUE OR (...)` still names both columns and
  --     refuses nothing, which this module has already caught once.
  --
  --     MEASURED FIRST, because the probe depends on it: `Insurer` is RLS `ENABLE`d and NOT `FORCE`d
  --     (`relrowsecurity = t`, `relforcerowsecurity = f`), and this migration runs as `ibms`, the
  --     table owner, whom Postgres exempts from a non-forced policy. The same measurement item (g)
  --     took for `Employee`. If FORCE is ever added, these INSERTs would fail with
  --     `insufficient_privilege` instead of reaching the CHECK — so that case is caught by name
  --     rather than surfacing as a confusing migration failure.
  SELECT o.id INTO org FROM "Organization" o LIMIT 1;
  IF org IS NOT NULL THEN
    BEGIN
      INSERT INTO "Insurer" ("id","organizationId","legalName","financialStrengthRating")
        VALUES ('00000000-0000-4000-8000-0000000ins01', org, 'Probe Insurer', 'A-');
      RAISE EXCEPTION 'a rating was accepted with no as-of date — the CHECK refuses nothing';
    EXCEPTION
      WHEN check_violation THEN NULL;
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'Insurer is now RLS-FORCED, so this migration cannot probe its own constraint. Re-point the assertion rather than deleting it';
    END;
    BEGIN
      INSERT INTO "Insurer" ("id","organizationId","legalName","financialStrengthRatingAsOf")
        VALUES ('00000000-0000-4000-8000-0000000ins02', org, 'Probe Insurer', DATE '2026-01-01');
      RAISE EXCEPTION 'an as-of date was accepted with no rating — the CHECK refuses nothing';
    EXCEPTION
      WHEN check_violation THEN NULL;
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'Insurer is now RLS-FORCED, so this migration cannot probe its own constraint. Re-point the assertion rather than deleting it';
    END;
  END IF;

  -- (5) NO ROWS WERE MODIFIED. The resolver's delivery evidence, asserted by the migration that
  --     could most easily have broken it: this item SPLITS a read (decision 63), it does not move
  --     data, and a migration that touched an existing `Insurer` or `Organization` row would be the
  --     first sign that the split had become a move.
  SELECT count(*) INTO n FROM "InsurerLicensedLine";
  IF n <> 0 THEN
    RAISE EXCEPTION 'InsurerLicensedLine already holds % row(s) — this migration creates the table and populates nothing', n;
  END IF;
  SELECT count(*) INTO n FROM "Insurer"
   WHERE "brokerRelationsName" IS NOT NULL OR "brokerRelationsEmail" IS NOT NULL
      OR "brokerRelationsPhone" IS NOT NULL OR "ratingAgencyId" IS NOT NULL
      OR "financialStrengthRatingAsOf" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Insurer row(s) came out of this migration carrying a value in a new column — nothing is backfilled', n;
  END IF;
  SELECT count(*) INTO n FROM "Organization" WHERE "insurerLicenseCertificateDocumentId" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Organization row(s) came out carrying a certificate id — nothing is backfilled', n;
  END IF;

  RAISE NOTICE 'InsurerLicensedLine created with RLS and no reach into BrokerLicense; five Insurer/Organization columns added, zero rows modified';
END $$;
