-- MODULE 0, ITEM (h): A ROLE'S SCOPE — the insurance type and branches its grants apply within.
--
-- The design note is `docs/decision-role-scope.md` and was written before this migration. The two
-- things a reader of the SCHEMA most needs from it are repeated here, because a column comment is
-- what somebody actually reads:
--
-- ============================================================================================
-- NULL IS UNRESTRICTED, NOT SCOPED-TO-NOTHING
-- ============================================================================================
-- Every role that exists when this migration runs reads NULL, and an empty branch list likewise
-- means every branch within the type. Reading NULL as "scoped to nothing" would refuse every write
-- in the system on the first deploy.
--
-- This is the same call as item (b)'s `brokerKind = CORPORATE` backfill — take the NON-RESTRICTING
-- value, because a migration must not retroactively narrow anybody's access — and the OPPOSITE of
-- item (a)'s no-default, where neither value was stricter so a default would have silently decided
-- a fact somebody forgot to state. The three differ on purpose; § 5 of the note says why.
--
-- The cost is stated rather than left to be discovered: a role an office MEANT to scope but left
-- blank is unrestricted and nothing warns. The Role screen states the scope in a sentence for that
-- reason — "may act in every insurance type" is something an administrator can disagree with, where
-- a blank field is not.
--
-- ============================================================================================
-- SCOPE IS NOT ENFORCED BY THIS SCHEMA, AND THAT IS RECORDED RATHER THAN IMPLIED
-- ============================================================================================
-- Two rules are APPLICATION-GRAIN by necessity, both because a Postgres CHECK compares columns of
-- one row of one table:
--
--   1. "a scope branch must lie within the role's own type" needs `Role.insuranceLineCategory`
--      plus the branch's catalogue row — two tables.
--   2. "a write carrying an insurance line must lie within the writer's role scope" needs the
--      caller's roles, their scopes and the resource's line — three.
--
-- Both live in `common/role-scope.ts`, and `role-scope.inventory.spec.ts` is what keeps them there:
-- it fails if a write surface carrying a line stops calling the one decision, and if that decision
-- is copied anywhere.
--
-- What the DATABASE does guarantee is the shape: exactly one catalogue per branch row, no duplicate
-- branch for one role, and the tenant FK.

ALTER TABLE "Role" ADD COLUMN "insuranceLineCategory" "InsuranceLineCategory";

CREATE TABLE "RoleScopeBranch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "roleId" TEXT NOT NULL,
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleScopeBranch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE, unlike the CBJ approval's RESTRICT. A role's scope is CONFIGURATION, not evidence:
-- `UserRoleAssignment` and `RolePermission` are what record who held what and they are RESTRICTed,
-- while a scope branch left behind by a deleted role would describe a scope nothing holds.
ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The tenant composite FK. Prisma models the single-column relation and cannot express this one.
-- Here it is load-bearing in a way worth naming: a role scope naming another office's bespoke line
-- would make one office's AUTHORIZATION depend on another office's catalogue.
ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- And the role itself must belong to the same office as its scope row, which IS expressible here
-- because `Role` carries `@@unique([id, organizationId])` already (added so `RolePermission`'s
-- composite FK had a target). Without it a scope row could claim a role from another office.
ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_role_same_org_fkey"
  FOREIGN KEY ("roleId", "organizationId")
  REFERENCES "Role"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleScopeBranch"
  ADD CONSTRAINT "RoleScopeBranch_exactly_one_line"
  CHECK (
    ("insuranceLineId" IS NOT NULL AND "officeInsuranceLineId" IS NULL)
    OR ("insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NOT NULL)
  );

CREATE INDEX "RoleScopeBranch_roleId_idx" ON "RoleScopeBranch" ("roleId");
CREATE INDEX "RoleScopeBranch_organizationId_idx" ON "RoleScopeBranch" ("organizationId");

-- PARTIAL, for the § 1.25 reason: a compound unique over these nullable columns would admit
-- unlimited rows whose column is NULL, which here is every row.
CREATE UNIQUE INDEX "RoleScopeBranch_one_standard_line_per_role"
  ON "RoleScopeBranch" ("roleId", "insuranceLineId")
  WHERE "insuranceLineId" IS NOT NULL;
CREATE UNIQUE INDEX "RoleScopeBranch_one_office_line_per_role"
  ON "RoleScopeBranch" ("roleId", "officeInsuranceLineId")
  WHERE "officeInsuranceLineId" IS NOT NULL;

ALTER TABLE "RoleScopeBranch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleScopeBranch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RoleScopeBranch_tenant_isolation" ON "RoleScopeBranch"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  def TEXT;
BEGIN
  -- 1. EVERY EXISTING ROLE IS UNRESTRICTED. The whole backward-compatibility claim in one check:
  --    if any role came out of this migration with a type, something narrowed access silently.
  SELECT count(*) INTO n FROM "Role" WHERE "insuranceLineCategory" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'role scope: % role(s) came out of this migration already scoped — a migration must not narrow access', n;
  END IF;

  -- 2. The column carries NO DEFAULT. A default would decide the scope of a role somebody created
  --    without naming one, which is the thing § 5 of the note argues against — and unlike the NULL
  --    backfill it would apply to FUTURE roles, forever.
  SELECT count(*) INTO n FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = '"Role"'::regclass AND a.attname = 'insuranceLineCategory';
  IF n <> 0 THEN
    RAISE EXCEPTION 'role scope: Role.insuranceLineCategory carries a DEFAULT; it must be NULL by absence, not by default';
  END IF;

  -- 3. RLS enabled AND FORCED, exactly one policy. FORCE is the half that is easy to omit and
  --    impossible to notice: the owner is exempt from a table's own policies.
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'RoleScopeBranch';
  IF n <> 1 THEN
    RAISE EXCEPTION 'role scope: expected exactly 1 RLS policy, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'RoleScopeBranch' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'role scope: RLS is not both ENABLED and FORCED.';
  END IF;

  -- 4. Both partial uniques exist and are STILL PARTIAL. `db:divergence` is blind to a partial
  --    index, so this block is the only thing between them and a future migration; asserted on the
  --    DEFINITION, because an index recreated without its WHERE clause keeps its name and starts
  --    rejecting every second standard-line row instead.
  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'RoleScopeBranch_one_standard_line_per_role';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('insuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'role scope: the standard-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'RoleScopeBranch_one_office_line_per_role';
  IF def IS NULL OR position('WHERE' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'role scope: the office-line partial unique is missing or no longer partial — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 5. The exactly-one-line CHECK still names BOTH columns. A predicate loosened to `TRUE OR (...)`
  --    satisfies a name-only check and refuses nothing.
  SELECT pg_get_constraintdef(c.oid) INTO def FROM pg_constraint c
   WHERE c.conrelid = '"RoleScopeBranch"'::regclass
     AND c.conname = 'RoleScopeBranch_exactly_one_line';
  IF def IS NULL OR position('insuranceLineId' IN def) = 0 OR position('officeInsuranceLineId' IN def) = 0 THEN
    RAISE EXCEPTION 'role scope: the exactly-one-line CHECK is missing or no longer names both columns — it reads %', coalesce(def, '(absent)');
  END IF;

  -- 6. BOTH tenant composite FKs. The role one is the sharper of the two: without it a scope row
  --    could claim a role from another office, which would make one office's authorization depend
  --    on another office's roles.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"RoleScopeBranch"'::regclass
     AND conname IN ('RoleScopeBranch_office_line_same_org_fkey', 'RoleScopeBranch_role_same_org_fkey');
  IF n <> 2 THEN
    RAISE EXCEPTION 'role scope: expected both tenant composite FKs, found %', n;
  END IF;

  RAISE NOTICE 'role scope: Role.insuranceLineCategory added with NO default and every existing role unrestricted; RoleScopeBranch created with RLS forced, both partial uniques, the exactly-one-line CHECK and both tenant FKs.';
END $$;
