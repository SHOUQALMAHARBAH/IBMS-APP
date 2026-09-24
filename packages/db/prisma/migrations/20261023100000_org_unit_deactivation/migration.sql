-- Departments and branches can be RETIRED, not deleted.
--
-- The owner's rule, already applied to roles: delete means deactivate by default, and real deletion
-- only where it is genuinely safe. It is not safe here. `User.departmentId` and `Employee.departmentId`
-- point at these rows, and a department a person was once assigned to is part of that person's
-- record — the same reasoning that made role deletion a soft delete.
--
-- So a retired unit stops being OFFERED for new people and keeps every existing assignment intact.
ALTER TABLE "Department" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- Partial, because every query that populates a picker asks the same question: which are still live.
CREATE INDEX "Department_live_idx" ON "Department" ("organizationId") WHERE "deactivatedAt" IS NULL;
CREATE INDEX "Branch_live_idx" ON "Branch" ("organizationId") WHERE "deactivatedAt" IS NULL;

-- A name is unique among the LIVE units of an office, not across all of history: retiring
-- "Claims" and later creating a new "Claims" is legitimate, while two live departments with one
-- name is the ambiguity a person cannot resolve from a dropdown.
--
-- Partial UNIQUE indexes, which `db:divergence` does not see (its measured blind spot) — so the
-- invariant is asserted here, reading `pg_index`, rather than trusted to a gate that cannot check it.
CREATE UNIQUE INDEX "Department_one_live_name_per_org"
  ON "Department" ("organizationId", lower("name")) WHERE "deactivatedAt" IS NULL;
CREATE UNIQUE INDEX "Branch_one_live_name_per_org"
  ON "Branch" ("organizationId", lower("name")) WHERE "deactivatedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'Department_one_live_name_per_org' AND i.indisunique AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Department_one_live_name_per_org is missing, not unique, or not partial';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'Branch_one_live_name_per_org' AND i.indisunique AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Branch_one_live_name_per_org is missing, not unique, or not partial';
  END IF;
END $$;
