-- One person, one record: the name in BOTH scripts, the branch beside the department, and how the
-- account signs in.
--
-- ## Why the name lives on Employee
--
-- The owner's requirement is a four-part name in Arabic AND English, and her rule is that the
-- employee and the user are one person. The name is a property of the PERSON and of the compliance
-- record: `Employee` already holds the Jordanian four-part convention, and the documents this system
-- generates render from the employee record. `User` keeps identity and credentials.
--
-- `User.fullName` therefore stays a STORED, NOT NULL column rather than becoming a view over this
-- one. "Derived" here means KEPT IN SYNC, never computed on read — because an account may have no
-- employee at all (the external auditor's read-only lens), and the audit row stores only `userId`,
-- so a name that could not be resolved would leave that actor nameless in the one place its name
-- matters most.
--
-- ## Nullable, and no transliteration guessing
--
-- All four English parts start NULL on the 133 existing employees. Nothing is backfilled: a
-- transliterated Arabic name is a guess about a real person's spelling of their own name, and a
-- guess stored in a compliance record is indistinguishable from a fact.
ALTER TABLE "Employee" ADD COLUMN "givenNameEn"       TEXT;
ALTER TABLE "Employee" ADD COLUMN "fatherNameEn"      TEXT;
ALTER TABLE "Employee" ADD COLUMN "grandfatherNameEn" TEXT;
ALTER TABLE "Employee" ADD COLUMN "familyNameEn"      TEXT;
-- Composed from the parts above the same way `fullName` is composed from the Arabic ones, by the one
-- `composeFullName` helper. Denormalised for the same reason: every consumer that sorts, searches or
-- prints a name reads one column.
ALTER TABLE "Employee" ADD COLUMN "fullNameEn"        TEXT;

-- A person belongs to a branch as well as a department. `Employee` carried only the department while
-- `User` required both, which is part of why the person and the account could not be registered in
-- one act. ON DELETE SET NULL matches the department FK beside it, and the branch cannot be deleted
-- anyway — it retires.
ALTER TABLE "Employee" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Employee"
  ADD CONSTRAINT "Employee_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_branchId_idx" ON "Employee" ("branchId");

-- ## How the account signs in
--
-- RECORDED ONLY. `DEFAULT` is a password held by this system; `WINDOWS` records that the office
-- intends a network identity. There is NO external authentication behind `WINDOWS` today and this
-- column grants nothing — the password path is the only one that works, and a value here does not
-- change it.
--
-- It is on `User` and not `Employee` because it describes the ACCOUNT, not the person: an employee
-- with no login has nothing to register, and the external-auditor account has no employee.
--
-- Shaped so the answer, if it comes back as real AD integration, is a provider configuration hanging
-- off this column rather than a rewrite of the person flow.
CREATE TYPE "RegistrationType" AS ENUM ('DEFAULT', 'WINDOWS');
ALTER TABLE "User" ADD COLUMN "registrationType" "RegistrationType" NOT NULL DEFAULT 'DEFAULT';

DO $$
BEGIN
  -- The English parts must be nullable: a NOT NULL here would have demanded a transliteration for
  -- every existing employee, which is exactly what was refused above.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Employee'
      AND column_name IN ('givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'familyNameEn', 'fullNameEn')
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'An English name part is NOT NULL; existing employees have no English name and none may be invented';
  END IF;
END $$;
