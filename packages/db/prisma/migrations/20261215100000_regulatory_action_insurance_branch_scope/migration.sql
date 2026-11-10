-- ART. 21/b/5 — A SUSPENSION LIMITED TO SOME INSURANCE BRANCHES, NOT THE WHOLE LICENCE.
--
-- «وقف أو إلغاء ترخيص وسيط التأمين في فرع أو أكثر من فروع التأمين» (Instructions No. 9 of 2026,
-- art. 21/b/5). Before this table the licence was ONE BIT for the whole office, so recording that
-- act would have blocked everything or nothing — and the regulator's own words permit stopping an
-- office in motor while it keeps working in medical.
--
-- ZERO SCOPE LINES MEANS THE WHOLE LICENCE. That is the compatibility hinge, and it needs no
-- back-fill: measured on dev 2026-11-10, `RegulatoryAction` holds 0 rows, so no existing act has to
-- be reinterpreted. Every act written from here on without scope lines keeps meaning office-wide.
--
-- THE SHAPE IS `BrokerLicenseScopeLine`'s, deliberately. An insurance branch is EITHER a standard
-- catalogue line OR an office's own addition, and three models already carry that exact nullable
-- pair with ON DELETE RESTRICT. A fourth shape for one fact is a fourth thing to keep in step.
--
-- THE GEOGRAPHIC HALF (art. 21/b/6) IS NOT A COLUMN HERE YET, and the reason is measured rather
-- than stylistic: no transaction carries a branch at all — `branchId` exists on `Employee`,
-- `SalesTarget` and `User` only, and 0 of 60 employees on dev have one — and `Branch` has no
-- country, so «في فرع أو أكثر داخل المملكة أو خارجها» is inexpressible. OWNER DECISION 124 settles
-- the shape (a transaction's branch is stamped at creation and frozen) and this table takes a
-- nullable "branchId" beside the pair, with its own partial unique, once that stamp exists. A
-- recorded suspension the gate cannot resolve must REFUSE, never permit, so the column waits for
-- something that can populate it.

CREATE TABLE "RegulatoryActionScopeLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "regulatoryActionId" TEXT NOT NULL,
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegulatoryActionScopeLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE, unlike the licence scope line's RESTRICT on its parent: a scope line has no meaning
-- without its act, and the act itself is the evidence that is protected (its `documentId` carries
-- ON DELETE RESTRICT). A scope line left behind by a deleted act would scope nothing.
ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_regulatoryActionId_fkey"
  FOREIGN KEY ("regulatoryActionId") REFERENCES "RegulatoryAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tenant FK. Prisma models the single-column relation and cannot express this one: without it a
-- scope line can name ANOTHER office's bespoke line, and no query would say so.
ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EXACTLY ONE of the two. A row naming neither scopes the act to nothing — which would silently
-- widen a partial suspension back to the whole licence by the zero-rows rule — and a row naming
-- both is two branches wearing one row.
ALTER TABLE "RegulatoryActionScopeLine"
  ADD CONSTRAINT "RegulatoryActionScopeLine_exactly_one_line"
  CHECK (
    ("insuranceLineId" IS NOT NULL AND "officeInsuranceLineId" IS NULL)
    OR ("insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NOT NULL)
  );

CREATE INDEX "RegulatoryActionScopeLine_regulatoryActionId_idx" ON "RegulatoryActionScopeLine" ("regulatoryActionId");
CREATE INDEX "RegulatoryActionScopeLine_organizationId_idx" ON "RegulatoryActionScopeLine" ("organizationId");

-- PARTIAL, because a compound unique over a nullable column refuses nothing: Postgres treats NULLs
-- as distinct, so one unique over both columns would admit the same branch twice. The § 1.25 trap.
CREATE UNIQUE INDEX "RegulatoryActionScopeLine_one_standard_line_per_act"
  ON "RegulatoryActionScopeLine" ("regulatoryActionId", "insuranceLineId")
  WHERE "insuranceLineId" IS NOT NULL;
CREATE UNIQUE INDEX "RegulatoryActionScopeLine_one_office_line_per_act"
  ON "RegulatoryActionScopeLine" ("regulatoryActionId", "officeInsuranceLineId")
  WHERE "officeInsuranceLineId" IS NOT NULL;

ALTER TABLE "RegulatoryActionScopeLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegulatoryActionScopeLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RegulatoryActionScopeLine_tenant_isolation" ON "RegulatoryActionScopeLine"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- ASSERTIONS — `db:divergence` cannot see a partial index or a policy, so they are asserted here.
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- 1. RLS is ENABLED and FORCED, with exactly one policy.
  --
  --    FORCE is the half that is easy to omit and impossible to notice: Postgres exempts a table's
  --    OWNER from its own policies and migrations run as the owner, so ENABLE without FORCE is
  --    isolation the runtime role never gets.
  SELECT count(*) INTO n FROM pg_class
   WHERE oid = '"RegulatoryActionScopeLine"'::regclass AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'regulatory action scope: RLS is not both ENABLED and FORCED';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'RegulatoryActionScopeLine';
  IF n <> 1 THEN
    RAISE EXCEPTION 'regulatory action scope: expected exactly 1 RLS policy, found %', n;
  END IF;

  -- 2. BOTH partial uniques exist AND both carry a WHERE clause. A non-partial index of the same
  --    name would satisfy a count and refuse nothing, which is the defect this asserts away.
  SELECT count(*) INTO n FROM pg_indexes
   WHERE tablename = 'RegulatoryActionScopeLine'
     AND indexname IN (
       'RegulatoryActionScopeLine_one_standard_line_per_act',
       'RegulatoryActionScopeLine_one_office_line_per_act')
     AND indexdef LIKE '%WHERE%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'regulatory action scope: expected 2 PARTIAL unique indexes, found % with a WHERE clause', n;
  END IF;

  -- 3. The exactly-one-line CHECK exists and still names both columns.
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conrelid = '"RegulatoryActionScopeLine"'::regclass
     AND c.conname = 'RegulatoryActionScopeLine_exactly_one_line';
  IF def IS NULL THEN
    RAISE EXCEPTION 'regulatory action scope: the exactly-one-line CHECK does not exist';
  END IF;
  IF position('insuranceLineId' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'regulatory action scope: the exactly-one-line CHECK no longer names both columns — it reads %', def;
  END IF;

  -- 4. The tenant composite FK is present, so a scope line cannot name another office's own line.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"RegulatoryActionScopeLine"'::regclass
     AND conname = 'RegulatoryActionScopeLine_office_line_same_org_fkey';
  IF n <> 1 THEN
    RAISE EXCEPTION 'regulatory action scope: the (officeInsuranceLineId, organizationId) tenant FK is missing';
  END IF;

  -- 5. THE ZERO-ROWS HINGE, asserted rather than described: no existing act may already carry a
  --    scope line, because "no lines" is what makes every act written before today office-wide.
  SELECT count(*) INTO n FROM "RegulatoryActionScopeLine";
  IF n <> 0 THEN
    RAISE EXCEPTION 'regulatory action scope: expected a new table to be empty, found % row(s)', n;
  END IF;

  RAISE NOTICE 'regulatory action scope: table created, RLS forced, two PARTIAL uniques, the exactly-one-line CHECK and the tenant FK all present; zero rows, so every existing act stays office-wide.';
END $$;
