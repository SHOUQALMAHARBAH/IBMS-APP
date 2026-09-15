-- Part II §4.2.2 (multi-tenancy Phase 4) — the Department an administrator
-- picks when provisioning an account.
--
-- Mirrors the `branchId` column directly beside it: §4.2.2 describes the admin
-- filling Branch (a location) and Department (a functional grouping) as two
-- separate fields on the same form, alongside one or more Roles (what the
-- person may do). §4.1.2's `Employee.departmentId` is the org-chart view of the
-- same idea and stays as it is; a freshly provisioned account often has no
-- `Employee` row yet, so without this column the required field would have
-- nowhere to land and the requirement would be hollow.
--
-- Nullable, because every pre-existing account was created before Departments
-- were a concept. New provisioning requires it at the API.

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- No new table, so the policy count must be unchanged.
DO $$
DECLARE policies integer;
BEGIN
  SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'public';
  IF policies <> 119 THEN
    RAISE EXCEPTION 'Expected 119 RLS policies, found %', policies;
  END IF;
END $$;
