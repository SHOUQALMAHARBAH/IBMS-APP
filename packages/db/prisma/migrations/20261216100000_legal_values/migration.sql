-- MODULE 1 — THE LEGAL-VALUES TABLE. A figure a program reads because a legal instrument says so,
-- with the article it comes from and the day it started applying.
--
-- OWNER DECISION 123, third form: a figure the instrument STATES is ours to seed with its article;
-- only a figure the instrument DEFERS to a ruling not yet issued is the office's to supply. The
-- catalogue is `packages/db/prisma/seed-data/legal-values.ts`; the model comment in schema.prisma
-- carries the three measured reasons this is a new table rather than an extension of `SlaPolicy`
-- or the ninth of the reference-table family.
--
-- `organizationId` IS NULLABLE AND NULL MEANS PROVIDER-OWNED. The column keeps the same
-- `DEFAULT current_setting('app.current_org_id', true)` every tenant-scoped table here has, and
-- the nullability is what makes that default right in both directions: inside a request it yields
-- the caller's office, and in the migration and the seed — which have no office — it yields NULL.
--
-- WHY THERE ARE THREE RLS POLICIES AND NOT ONE, measured against a live database before it was
-- written (a throwaway table, three policies, a throwaway non-owner role, rolled back):
--
--   * `ibms` is NOT a superuser and has NO `BYPASSRLS` (`SELECT rolsuper, rolbypassrls FROM
--     pg_roles` — both false). With `FORCE ROW LEVEL SECURITY` the owner is therefore subject to
--     the table's own policies, so the SEED could not write a provider row under the tenant policy
--     alone. The third policy, granted `TO` the owner and restricted to `organizationId IS NULL`,
--     is what lets it — and it is deliberately NOT `USING (true)`: the owner gains no ability to
--     read or write an office's rows that it did not already have.
--   * An office account (`ibms_app`, with `app.current_org_id` set) measured against those three
--     policies: inserting its own row OK; inserting a NULL-org row → `new row violates row-level
--     security policy`; inserting another office's row → the same; UPDATE and DELETE of a provider
--     row → 0 rows; SELECT → its own rows plus the provider's; and a DIFFERENT office → the
--     provider's rows only. That is decision 123's criterion 7 refused at the database rather than
--     in application logic, and criterion 4's isolation in the same breath.
--
-- NO BACK-FILL AND NOTHING REINTERPRETED: the table is new and asserted EMPTY below. The provider
-- rows arrive through the seed, which is why `scripts/from-empty.sh` is the gate that sees them.

CREATE TYPE "LegalValueKind" AS ENUM (
  'MONEY_JOD', 'COUNT', 'CALENDAR_DAYS', 'YEARS', 'PERCENT', 'DATE', 'TEXT_LIST'
);
CREATE TYPE "LegalValueSourceType" AS ENUM ('INSTRUMENT', 'OFFICE_DECLARATION');

CREATE TABLE "LegalValue" (
  "id" TEXT NOT NULL,
  -- NULLABLE. NULL = provider-owned. See the header.
  "organizationId" TEXT DEFAULT current_setting('app.current_org_id', true),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "LegalValueKind" NOT NULL,
  "numericValue" DECIMAL(18,3),
  "dateValue" DATE,
  "sourceType" "LegalValueSourceType" NOT NULL,
  "sourceInstrument" TEXT,
  "sourceArticle" TEXT,
  "sourcePrintedPage" INTEGER,
  "sourceReference" TEXT,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "note" TEXT,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- No DB default: `@updatedAt` is written by Prisma on every update, and a DEFAULT here is a
  -- divergence `prisma migrate dev` would generate a DROP for (named by `db:divergence`).
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegalValue_pkey" PRIMARY KEY ("id")
);

-- NOT VALID is deliberately NOT used: the table is empty, so there is nothing to grandfather.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE CHECKS. Decision 123's three conditions on an office-supplied row and its criterion 7, in
-- the one place a caller cannot forget them.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- CRITERION 7, THE FIRST HALF. An office row may not claim the instrument's authority and a
-- provider row may not claim the office's. `sourceType` is therefore not a second home for
-- `organizationId IS NULL` — it is tied to it in BOTH directions, so the two cannot drift.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_owner_matches_source_type"
  CHECK (
    ("organizationId" IS NULL AND "sourceType" = 'INSTRUMENT')
    OR ("organizationId" IS NOT NULL AND "sourceType" = 'OFFICE_DECLARATION')
  );

-- EVERY PROVIDER ROW CARRIES ITS CITATION: instrument, article, and the printed page it was READ
-- on. The page is not decoration — our OCR extraction of this instrument publishes two wrong
-- figures marked «موثوق», so a citation with no page cannot be checked against anything.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_provider_row_cites_its_source"
  CHECK (
    "organizationId" IS NOT NULL
    OR (
      "sourceInstrument" IS NOT NULL AND btrim("sourceInstrument") <> ''
      AND "sourceArticle" IS NOT NULL AND btrim("sourceArticle") <> ''
      AND "sourcePrintedPage" IS NOT NULL
    )
  );

-- DECISION 123's THREE CONDITIONS on an office row: its own permission to enter it (the
-- application's, and `createdByUserId` is what records WHO used it), a mandatory reference, and a
-- mandatory date. The date is structural — `effectiveFrom` is NOT NULL for every row — so this
-- constraint carries the other two. CRITERION 2: remove the reference or the date and the row is
-- refused.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_office_row_cites_its_reference"
  CHECK (
    "organizationId" IS NULL
    OR (
      "sourceReference" IS NOT NULL AND btrim("sourceReference") <> ''
      AND "createdByUserId" IS NOT NULL
    )
  );

-- THE VALUE LIVES IN THE COLUMN ITS KIND NAMES, and `TEXT_LIST` carries neither — that is how the
-- three codes the Central Bank has not issued exist with a shape and NO value. A reader asking
-- *which column holds this figure* must not have to guess, and a figure in both columns would be
-- two answers.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_value_column_matches_kind"
  CHECK (
    CASE
      WHEN "kind" = 'DATE' THEN "numericValue" IS NULL
      WHEN "kind" = 'TEXT_LIST' THEN "numericValue" IS NULL AND "dateValue" IS NULL
      ELSE "dateValue" IS NULL
    END
  );

-- A PROVIDER ROW IS NEVER A BARE SHAPE. We seed only figures the instrument states, so a
-- provider row with no value would be this system asserting a legal value it does not have —
-- which is what OWNER DECISION 123 forbids. An OFFICE row MAY have no value: that is DORMANT
-- (criterion 6), and dormant is a real and necessary state.
ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_provider_row_states_a_figure"
  CHECK (
    "organizationId" IS NOT NULL
    OR (
      "kind" <> 'TEXT_LIST'
      AND (
        ("kind" = 'DATE' AND "dateValue" IS NOT NULL)
        OR ("kind" <> 'DATE' AND "numericValue" IS NOT NULL)
      )
    )
  );

ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_effective_window_is_ordered"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

ALTER TABLE "LegalValue"
  ADD CONSTRAINT "LegalValue_code_and_name_are_not_blank"
  CHECK (btrim("code") <> '' AND btrim("name") <> '');

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ONE CURRENT ROW PER CODE, ANY NUMBER OF HISTORICAL ONES.
--
-- PARTIAL on `effectiveTo IS NULL`, and SPLIT by ownership because a compound unique over a
-- nullable column refuses nothing: Postgres treats NULLs as distinct, so one index over
-- ("organizationId", "code") would admit the same provider code twice. The § 1.25 trap.
--
-- This is the property `SlaPolicy` cannot give us. Its `@@unique([organizationId, policyCode])`
-- stops a superseded value sitting beside its replacement, and criterion 3 — read an old
-- transaction and it computes at the value in force on ITS day — needs exactly that.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "LegalValue_one_current_provider_row_per_code"
  ON "LegalValue" ("code")
  WHERE "organizationId" IS NULL AND "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "LegalValue_one_current_office_row_per_code"
  ON "LegalValue" ("organizationId", "code")
  WHERE "organizationId" IS NOT NULL AND "effectiveTo" IS NULL;

CREATE INDEX "LegalValue_code_effectiveFrom_idx" ON "LegalValue" ("code", "effectiveFrom");
CREATE INDEX "LegalValue_organizationId_idx" ON "LegalValue" ("organizationId");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY — three policies, each doing one thing.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "LegalValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalValue" FORCE ROW LEVEL SECURITY;

-- 1. The office's own rows, read and written. Identical in shape to every other tenant policy
--    here, and fail-closed: `current_setting(..., true)` is NULL when unset and `col = NULL` is
--    NULL, never true.
CREATE POLICY "LegalValue_tenant_isolation" ON "LegalValue"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- 2. The provider's rows are READABLE BY EVERY OFFICE. They are the instrument's own figures;
--    an office that cannot read them cannot compute anything. SELECT only — no office may write
--    one, which is criterion 7 refused here rather than in a service.
CREATE POLICY "LegalValue_provider_rows_are_readable" ON "LegalValue"
  FOR SELECT USING ("organizationId" IS NULL);

-- 3. And the provider's rows are WRITABLE BY THE MIGRATION/SEED ROLE ALONE, restricted to rows
--    that are actually the provider's. `FORCE` makes the owner subject to its own policies, so
--    without this the seed could not insert a figure the instrument states. Written with the
--    CURRENT role name rather than a literal `ibms`, so a deployment whose owner is called
--    something else gets the same guarantee instead of a silently inert policy.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "LegalValue_provider_rows_writable_by_owner" ON "LegalValue" '
    'FOR ALL TO %I USING ("organizationId" IS NULL) WITH CHECK ("organizationId" IS NULL)',
    current_user
  );
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS — `db:divergence` cannot see a partial index, a policy or a CHECK, so they are
-- asserted here, where a migration that half-applied says so instead of looking finished.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- 1. RLS ENABLED and FORCED, with exactly three policies.
  --
  --    FORCE is the half that is easy to omit and impossible to notice: Postgres exempts a
  --    table's OWNER from its own policies and migrations run as the owner, so ENABLE without
  --    FORCE is isolation the runtime role never gets.
  SELECT count(*) INTO n FROM pg_class
   WHERE oid = '"LegalValue"'::regclass AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'legal values: RLS is not both ENABLED and FORCED';
  END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'LegalValue';
  IF n <> 3 THEN
    RAISE EXCEPTION 'legal values: expected exactly 3 RLS policies, found %', n;
  END IF;

  -- 2. The provider-write policy is restricted TO A ROLE. A policy with no role restriction
  --    would hand every office the provider's write, which is the one thing criterion 7 forbids.
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'LegalValue'
     AND policyname = 'LegalValue_provider_rows_writable_by_owner'
     AND roles <> '{public}';
  IF n <> 1 THEN
    RAISE EXCEPTION 'legal values: the provider-write policy is not restricted to a role -- it would grant every office the provider''s write';
  END IF;

  -- 3. BOTH uniques exist AND both carry a WHERE clause. A non-partial index of the same name
  --    would satisfy a count and refuse the wrong thing -- it would stop a superseded row
  --    sitting beside its replacement, which is the defect this table exists to avoid.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE tablename = 'LegalValue'
     AND indexname IN (
       'LegalValue_one_current_provider_row_per_code',
       'LegalValue_one_current_office_row_per_code')
     AND indexdef LIKE '%WHERE%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'legal values: expected 2 PARTIAL unique indexes, found % with a WHERE clause', n;
  END IF;

  -- 4. Every one of the six CHECKs is present, by name.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"LegalValue"'::regclass AND contype = 'c'
     AND conname IN (
       'LegalValue_owner_matches_source_type',
       'LegalValue_provider_row_cites_its_source',
       'LegalValue_office_row_cites_its_reference',
       'LegalValue_value_column_matches_kind',
       'LegalValue_provider_row_states_a_figure',
       'LegalValue_effective_window_is_ordered');
  IF n <> 6 THEN
    RAISE EXCEPTION 'legal values: expected 6 named CHECK constraints, found %', n;
  END IF;

  -- 5. The ownership CHECK still names BOTH sides. A constraint of the right name that has been
  --    rewritten to check only one direction would pass assertion 4 and refuse nothing.
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = '"LegalValue"'::regclass
     AND conname = 'LegalValue_owner_matches_source_type';
  IF position('INSTRUMENT' IN def) = 0 OR position('OFFICE_DECLARATION' IN def) = 0 THEN
    RAISE EXCEPTION 'legal values: the ownership CHECK no longer names both source types -- it reads %', def;
  END IF;

  -- 6. `organizationId` IS NULLABLE. This is the hinge of the whole design, and a later
  --    migration tightening it to NOT NULL would delete the provider's half of the table with
  --    nothing saying so.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'LegalValue' AND column_name = 'organizationId' AND is_nullable = 'YES';
  IF n <> 1 THEN
    RAISE EXCEPTION 'legal values: "organizationId" is NOT NULL -- a provider-owned row can no longer exist';
  END IF;

  -- 7. The table is EMPTY. Nothing is back-filled and no existing figure is reinterpreted; the
  --    provider rows arrive through the seed.
  SELECT count(*) INTO n FROM "LegalValue";
  IF n <> 0 THEN
    RAISE EXCEPTION 'legal values: expected a new table to be empty, found % row(s)', n;
  END IF;

  RAISE NOTICE 'legal values: table created; RLS forced with 3 policies (one role-restricted); 2 PARTIAL uniques; 6 CHECKs; organizationId nullable so NULL means provider-owned; zero rows.';
END $$;
