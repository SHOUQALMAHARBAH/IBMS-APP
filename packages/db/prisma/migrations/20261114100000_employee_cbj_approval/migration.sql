-- MODULE 0, ITEM (g): THE CBJ APPROVAL MARKER ON A PERSON — and the free-text version it replaces.
--
-- The marker records, per person: the insurance TYPE and BRANCHES the CBJ approved them for, the
-- approval DATE, and the STATUS (current / suspended / cancelled). It exists to support the vacancy
-- timers and the training counter, and item (f)'s minimum-staff rule reads it.
--
-- ============================================================================================
-- IT GOES ON `Employee`, NOT ON `User` — and that is a correction, stated plainly
-- ============================================================================================
-- The item was written as "an approval marker on the user". It is on the PERSON record instead,
-- because every other constraint points there: the CBJ approves a natural person, item (f) counts
-- approved PERSONS, an approved broker may hold no login at all, and this system already has a
-- `User` with no `Employee` behind it (the external auditor). On `User` it would have made a login
-- a precondition of CBJ approval, which it is not.
--
-- ============================================================================================
-- AND IT IS NOT NEW — 54 ROWS ALREADY CARRIED IT AS FREE TEXT
-- ============================================================================================
-- `Employee.licensedRole` is a free-text column whose stated purpose is "regulated staff
-- licensing/certification", and it was already being used for exactly this. MEASURED on both
-- databases before deciding anything:
--
--   dev      47 of 136 employees read 'CBJ Licensed Insurance Broker'      (89 null)
--   db-test   7 of 147 employees read 'CBJ-licensed Broker Representative' (140 null)
--
-- TWO DIFFERENT SPELLINGS OF ONE FACT, which is the whole argument for structure — and a backfill
-- matching dev's exact string would have migrated 47 and silently left db-test's 7 behind, so the
-- match is case-insensitive on 'cbj' and the assertion below counts what it moved.
--
-- The free-text column is NOT dropped: its stated purpose is broader than the CBJ approval, and
-- removing a capability nobody asked to lose is not this item's business. It is RE-SCOPED — CBJ
-- approval lives here now, and `EmployeeService` refuses CBJ-ish text in `licensedRole`, naming the
-- structured field, so the second home cannot come back.
--
-- ============================================================================================
-- THE BACKFILL IS UNFILTERED, AND THAT IS MEASURED RATHER THAN HOPED
-- ============================================================================================
-- `Employee` has RLS ENABLED and NOT FORCED (measured: pg_class.relrowsecurity = true,
-- relforcerowsecurity = false), and a migration runs as the table OWNER, whom Postgres exempts from
-- a table's own policies. So this UPDATE sees every office.
--
-- That is a property worth asserting, not assuming: this repository has already been bitten by an
-- RLS policy that silently matched nothing because `app.current_org_id` is never set in a
-- migration. If FORCE is ever added to `Employee`, this migration's row count would silently drop
-- to 0 — so the DO block compares what it moved against what it found, and a filtered backfill
-- fails the migration instead of succeeding quietly.
--
-- ============================================================================================
-- THE APPROVAL DATE IS ALLOWED TO BE UNKNOWN
-- ============================================================================================
-- The 54 migrated rows have no date on record. Stamping them with the migration date would record a
-- fact nobody can source — the one thing worse than a missing date is an invented one — so they
-- carry a status and a NULL date, and the CHECK permits exactly that while refusing the reverse: a
-- date with no status is a half-written approval nobody can act on.
--
-- ============================================================================================
-- IT IS NOT A SECOND ROLE SYSTEM
-- ============================================================================================
-- Deliberately not an authorization input. Item (h) puts scope on the ROLE; this marker is read by
-- the staff-minimum rule and the screens. `employee-cbj-approval.guard.spec.ts` fails if any
-- permission-evaluation site starts reading it.

CREATE TYPE "CbjApprovalStatus" AS ENUM ('CURRENT', 'SUSPENDED', 'CANCELLED');

ALTER TABLE "Employee" ADD COLUMN "cbjApprovalStatus" "CbjApprovalStatus";
ALTER TABLE "Employee" ADD COLUMN "cbjApprovalDate" DATE;

-- A date with no status is a half-written approval. The reverse IS allowed and is the migrated
-- state: a status whose date nobody recorded.
ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_cbj_approval_date_needs_status"
  CHECK ("cbjApprovalDate" IS NULL OR "cbjApprovalStatus" IS NOT NULL);

CREATE INDEX "Employee_cbjApprovalStatus_idx" ON "Employee" ("cbjApprovalStatus");

CREATE TABLE "EmployeeCbjApprovalBranch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "employeeId" TEXT NOT NULL,
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeCbjApprovalBranch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT: what a person was approved for is evidence, the treatment `KYCRecord` gives a
-- `Customer`. Measured before choosing it — nothing in this repository deletes an `Employee`.
ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tenant FK. Prisma models the single-column relation and cannot express this one, so an
-- approval branch claiming another office's bespoke line is unINSERTable rather than merely
-- unqueried. Named `_office_line_same_org_fkey`, matching the nine siblings.
ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeCbjApprovalBranch"
  ADD CONSTRAINT "EmployeeCbjApprovalBranch_exactly_one_line"
  CHECK (
    ("insuranceLineId" IS NOT NULL AND "officeInsuranceLineId" IS NULL)
    OR ("insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NOT NULL)
  );

CREATE INDEX "EmployeeCbjApprovalBranch_employeeId_idx" ON "EmployeeCbjApprovalBranch" ("employeeId");
CREATE INDEX "EmployeeCbjApprovalBranch_organizationId_idx" ON "EmployeeCbjApprovalBranch" ("organizationId");

-- PARTIAL, for the § 1.25 reason: a compound unique over these nullable columns would admit
-- unlimited rows whose column is NULL, which here is every row.
CREATE UNIQUE INDEX "EmployeeCbjApprovalBranch_one_standard_line_per_person"
  ON "EmployeeCbjApprovalBranch" ("employeeId", "insuranceLineId")
  WHERE "insuranceLineId" IS NOT NULL;
CREATE UNIQUE INDEX "EmployeeCbjApprovalBranch_one_office_line_per_person"
  ON "EmployeeCbjApprovalBranch" ("employeeId", "officeInsuranceLineId")
  WHERE "officeInsuranceLineId" IS NOT NULL;

ALTER TABLE "EmployeeCbjApprovalBranch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeCbjApprovalBranch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "EmployeeCbjApprovalBranch_tenant_isolation" ON "EmployeeCbjApprovalBranch"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- THE BACKFILL AND THE ASSERTIONS, IN ONE BLOCK SO THE COUNTS CAN BE COMPARED
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  found   INTEGER;
  moved   INTEGER;
  def     TEXT;
  dtype   TEXT;
BEGIN
  -- 1. The enum has exactly the three values. A fourth added later without a decision would be a
  --    new state every reader of this marker silently does not handle.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'CbjApprovalStatus';
  IF n <> 3 THEN
    RAISE EXCEPTION 'cbj approval: expected 3 status values, found %', n;
  END IF;

  -- 2. The date column is a DATE, not a timestamp. A CBJ approval is granted on a day; storing an
  --    instant would invite a timezone question that has no answer here.
  SELECT data_type INTO dtype FROM information_schema.columns
   WHERE table_name = 'Employee' AND column_name = 'cbjApprovalDate';
  IF dtype IS DISTINCT FROM 'date' THEN
    RAISE EXCEPTION 'cbj approval: Employee.cbjApprovalDate is %, expected date', coalesce(dtype, '(absent)');
  END IF;

  -- 3. The date-needs-status CHECK exists and still names both columns.
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conrelid = '"Employee"'::regclass
     AND c.conname = 'Employee_cbj_approval_date_needs_status';
  IF def IS NULL OR position('cbjApprovalDate' IN def) = 0 OR position('cbjApprovalStatus' IN def) = 0 THEN
    RAISE EXCEPTION 'cbj approval: the date-needs-status CHECK is missing or no longer names both columns — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 4. The branch table: RLS enabled AND FORCED, exactly one policy. FORCE is the half that is easy
  --    to omit and impossible to notice, because the owner is exempt from a table's own policies.
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'EmployeeCbjApprovalBranch';
  IF n <> 1 THEN
    RAISE EXCEPTION 'cbj approval: expected exactly 1 RLS policy on the branch table, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'EmployeeCbjApprovalBranch' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'cbj approval: branch-table RLS is not both ENABLED and FORCED.';
  END IF;

  -- 5. Both partial uniques exist and are STILL PARTIAL. `db:divergence` cannot see a partial
  --    index, so this is the only thing standing between them and a future migration; asserted on
  --    the DEFINITION, because an index recreated without its WHERE clause keeps the name and
  --    starts rejecting every second standard-line row instead.
  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'EmployeeCbjApprovalBranch_one_standard_line_per_person';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('insuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'cbj approval: the standard-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'EmployeeCbjApprovalBranch_one_office_line_per_person';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'cbj approval: the office-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 6. The exactly-one-line CHECK and the tenant composite FK.
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conrelid = '"EmployeeCbjApprovalBranch"'::regclass
     AND c.conname = 'EmployeeCbjApprovalBranch_exactly_one_line';
  IF def IS NULL OR position('insuranceLineId' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'cbj approval: the exactly-one-line CHECK is missing or no longer names both columns — it reads %', coalesce(def, '(absent)');
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"EmployeeCbjApprovalBranch"'::regclass
     AND conname = 'EmployeeCbjApprovalBranch_office_line_same_org_fkey';
  IF n <> 1 THEN
    RAISE EXCEPTION 'cbj approval: the (officeInsuranceLineId, organizationId) tenant FK is missing';
  END IF;

  -- ------------------------------------------------------------------------------------------
  -- 7. THE BACKFILL. Case-insensitive on 'cbj', because the two databases spell it differently
  --    and an exact match would migrate one and silently skip the other.
  -- ------------------------------------------------------------------------------------------
  SELECT count(*) INTO found FROM "Employee" WHERE "licensedRole" ILIKE '%cbj%';

  UPDATE "Employee"
     SET "cbjApprovalStatus" = 'CURRENT',
         "licensedRole"      = NULL
   WHERE "licensedRole" ILIKE '%cbj%';
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- The RLS reach check. If `Employee` ever gains FORCE, this UPDATE sees nothing and the counts
  -- disagree — which must fail the migration rather than report a quiet success.
  IF moved <> found THEN
    RAISE EXCEPTION 'cbj approval: found % free-text CBJ rows but moved % — the backfill did not reach every row (is Employee now FORCE RLS?)', found, moved;
  END IF;

  -- And nothing CBJ-ish is left behind in the free-text column, which is the state the re-scoping
  -- claims. Checked AFTER the update rather than inferred from it.
  SELECT count(*) INTO n FROM "Employee" WHERE "licensedRole" ILIKE '%cbj%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'cbj approval: % employees still carry CBJ text in licensedRole', n;
  END IF;

  -- Every migrated row is CURRENT with a NULL date — a status nobody dated, recorded as unknown.
  SELECT count(*) INTO n FROM "Employee"
   WHERE "cbjApprovalStatus" = 'CURRENT' AND "cbjApprovalDate" IS NULL;
  IF n < moved THEN
    RAISE EXCEPTION 'cbj approval: expected at least % CURRENT rows with an unknown date, found %', moved, n;
  END IF;

  RAISE NOTICE 'cbj approval: marker + branch table created, RLS forced, both partial uniques, the date-needs-status CHECK and the tenant FK all present; % free-text CBJ rows migrated to CURRENT with an unrecorded date.', moved;
END $$;
