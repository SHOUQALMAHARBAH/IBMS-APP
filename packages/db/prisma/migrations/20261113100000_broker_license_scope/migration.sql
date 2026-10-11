-- MODULE 0, ITEM (e): WHAT THE OFFICE IS LICENSED FOR — types and branches — AND ITS CAPITAL.
--
-- CBJ Instructions No. 9 of 2026:
--   art. 3/a — a broker is licensed for insurance TYPES (life, general) and branches within each.
--   art. 4/a — the capital requirement scales with the branch count: 5,000 JOD per type up to 6
--              branches, 7,500 up to 12, 10,000 above 12.
--
-- ============================================================================================
-- THE TYPE IS DERIVED, NEVER STORED — and this was measured before it was decided
-- ============================================================================================
-- `InsuranceLineCategory` already has exactly two values, GENERAL and LIFE, which is precisely the
-- pair art. 3/a names; and every row of both line catalogues already carries one (measured: 27
-- GENERAL and 5 LIFE across the 32 standard lines).
--
-- So a licence's TYPES are the distinct categories of the branches it lists. Storing a type column
-- beside the branch would create a second home for the same fact, and the copy is the one that
-- drifts — the same reasoning that keeps `canonical_name_key` in the database with a TypeScript
-- mirror for suggestions only.
--
-- ============================================================================================
-- TWO CATALOGUES, EXACTLY ONE FK SET
-- ============================================================================================
-- A branch is a row of the managed line catalogue, and this system has two: `InsuranceLine` (the 32
-- standard lines, global) and `OfficeInsuranceLine` (an office's own additions). The established
-- shape for a model that can point at either is two nullable FKs — `InsuranceProgramLine`, `RFQ`,
-- `Policy` and `CommissionAgreement` all carry that pair — so this follows it rather than inventing
-- a third arrangement.
--
-- `BrokerLicenseScopeLine_exactly_one_line` makes "one or the other, never both and never neither"
-- structural. Without it the table admits a row naming no branch at all, which would be counted by
-- art. 4/a's branch arithmetic as a branch.
--
-- The composite FK `(officeInsuranceLineId, organizationId) -> OfficeInsuranceLine(id,
-- organizationId)` is the recorded tenant pattern: it makes a scope line that claims another
-- office's bespoke line unINSERTable, rather than relying on every query remembering to filter.
--
-- ============================================================================================
-- "THE SAME BRANCH TWICE" IS TWO PARTIAL UNIQUES, NOT A COMPOUND ONE
-- ============================================================================================
-- A compound unique over a nullable column admits UNLIMITED rows whose column is NULL, because
-- Postgres treats NULLs as distinct. That is IMPROVEMENTS § 1.25 — the trap that let six insurers
-- each carry two simultaneously-open commission agreements — and here it would be the common case,
-- since every standard-line row has a NULL `officeInsuranceLineId` and vice versa.
--
-- Two partial uniques instead, each scoped to the column being non-null. `db:divergence` CANNOT SEE
-- a partial index (a measured blind spot of that gate), so both are asserted below by reading
-- `pg_index` — otherwise a future migration could drop either and the gate would stay green.
--
-- ============================================================================================
-- ART. 3/a's ONE-TYPE RULE FOR A NATURAL PERSON IS NOT A CHECK, AND CANNOT BE
-- ============================================================================================
-- Item (b) deferred that rule here, and here it meets the database's limits honestly: deciding it
-- requires `Organization.brokerKind`, this table's rows, and `InsuranceLine.category` — three
-- tables. A Postgres CHECK compares columns of ONE row of ONE table, so it cannot express this.
--
-- A TRIGGER could, and is deliberately not written: it would have to fire on this table and on
-- `Organization.brokerKind` changing, which is two triggers and two places for the rule to live. It
-- is enforced in `BrokerLicenseScopeService` with an e2e proving the refusal over real HTTP, and is
-- recorded as application-only in the same way three maker/checker pairs already are — named rather
-- than left for a reader to discover.

ALTER TABLE "Organization" ADD COLUMN "paidUpCapital" DECIMAL(18,3);

CREATE TABLE "BrokerLicenseScopeLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "brokerLicenseId" TEXT NOT NULL,
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrokerLicenseScopeLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_brokerLicenseId_fkey"
  FOREIGN KEY ("brokerLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tenant FK. Prisma models the single-column relation above and cannot express this one.
ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BrokerLicenseScopeLine"
  ADD CONSTRAINT "BrokerLicenseScopeLine_exactly_one_line"
  CHECK (
    ("insuranceLineId" IS NOT NULL AND "officeInsuranceLineId" IS NULL)
    OR ("insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NOT NULL)
  );

CREATE INDEX "BrokerLicenseScopeLine_brokerLicenseId_idx" ON "BrokerLicenseScopeLine" ("brokerLicenseId");
CREATE INDEX "BrokerLicenseScopeLine_organizationId_idx" ON "BrokerLicenseScopeLine" ("organizationId");

-- See the header: partial, because a compound unique over a nullable column refuses nothing.
CREATE UNIQUE INDEX "BrokerLicenseScopeLine_one_standard_line_per_term"
  ON "BrokerLicenseScopeLine" ("brokerLicenseId", "insuranceLineId")
  WHERE "insuranceLineId" IS NOT NULL;
CREATE UNIQUE INDEX "BrokerLicenseScopeLine_one_office_line_per_term"
  ON "BrokerLicenseScopeLine" ("brokerLicenseId", "officeInsuranceLineId")
  WHERE "officeInsuranceLineId" IS NOT NULL;

ALTER TABLE "BrokerLicenseScopeLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerLicenseScopeLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BrokerLicenseScopeLine_tenant_isolation" ON "BrokerLicenseScopeLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n           INTEGER;
  def         TEXT;
  cap_type    TEXT;
  cap_scale   INTEGER;
BEGIN
  -- 1. RLS is ENABLED and FORCED, and there is exactly one policy.
  --
  --    FORCE is the half that is easy to omit and impossible to notice: Postgres exempts a table's
  --    OWNER from its own policies, and migrations run as the owner — so ENABLE without FORCE is
  --    isolation the runtime role never actually gets. This repo measured that once and found an
  --    unfiltered cross-office read returning 13,774 rows where 1 was expected.
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'BrokerLicenseScopeLine';
  IF n <> 1 THEN
    RAISE EXCEPTION 'licence scope: expected exactly 1 RLS policy, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'BrokerLicenseScopeLine' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'licence scope: RLS is not both ENABLED and FORCED.';
  END IF;

  -- 2. BOTH PARTIAL UNIQUES EXIST AND ARE STILL PARTIAL.
  --
  --    `db:divergence` is blind to a partial index, so this block is the only thing standing
  --    between them and a future migration. Asserted on the DEFINITION rather than the name,
  --    because an index recreated without its WHERE clause keeps the name and stops refusing the
  --    thing it was built for — it would then reject every second standard-line row instead.
  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'BrokerLicenseScopeLine_one_standard_line_per_term';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('insuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'licence scope: the standard-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'BrokerLicenseScopeLine_one_office_line_per_term';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'licence scope: the office-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 3. The exactly-one-line CHECK exists and still names BOTH columns. A predicate loosened to
  --    `TRUE OR (...)` satisfies a name-only check and refuses nothing.
  SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
   WHERE c.conrelid = '"BrokerLicenseScopeLine"'::regclass
     AND c.conname = 'BrokerLicenseScopeLine_exactly_one_line';
  IF def IS NULL THEN
    RAISE EXCEPTION 'licence scope: the exactly-one-line CHECK does not exist';
  END IF;
  IF position('insuranceLineId' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'licence scope: the exactly-one-line CHECK no longer names both columns — it reads %', def;
  END IF;

  -- 4. The tenant composite FK is present. Without it a scope line can claim another office's
  --    bespoke line, and nothing in a query would say so.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"BrokerLicenseScopeLine"'::regclass
     AND conname = 'BrokerLicenseScopeLine_office_line_same_org_fkey';
  IF n <> 1 THEN
    RAISE EXCEPTION 'licence scope: the (officeInsuranceLineId, organizationId) tenant FK is missing';
  END IF;

  -- 5. Capital is money at fils precision — Decimal(18,3), the one shape `money.util.ts` quantizes.
  --    A float here would be the money-decimal-jod violation the build gates exist to refuse.
  SELECT data_type, numeric_scale INTO cap_type, cap_scale
    FROM information_schema.columns
   WHERE table_name = 'Organization' AND column_name = 'paidUpCapital';
  IF cap_type IS DISTINCT FROM 'numeric' OR cap_scale IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'licence scope: Organization.paidUpCapital is % scale %, expected numeric scale 3', cap_type, cap_scale;
  END IF;

  RAISE NOTICE 'licence scope: table created, RLS forced, two partial uniques, the exactly-one-line CHECK and the tenant FK all present; paidUpCapital is numeric(18,3).';
END $$;
