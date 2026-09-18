-- Office-scoped custom RBAC, PHASE 3 workstream A — a role can be retired, and
-- the platform's own roles can be protected from the office's Role screen.
--
-- `status` — RETIREMENT, NOT DELETION
-- ----------------------------------
-- `UserRoleAssignment` and `RolePermission` both reference `Role`, and those
-- rows are the record of who held what and when (`UserRoleAssignment.revokedAt`
-- exists precisely to keep it). Deleting a role either fails on the foreign key
-- or cascades that history away, so the Role screen offers retirement and there
-- is no `DELETE /rbac/roles/:id`.
--
-- Adding the column is the easy half. The enforcement half — making INACTIVE
-- reach `findCodesForRoles`, `findActiveHoldersOfPermission`,
-- `roleGrantsPermission` and `findActiveUserIdsWithPermission` — lands in the
-- NEXT commit, deliberately before anything can set the column, because a
-- retired role that still granted would be a silent privilege retention.
--
-- `isSystem` — A PROTECTION FLAG THAT GRANTS NOTHING
-- -------------------------------------------------
-- True for the eleven converted legacy roles here, and for
-- `OFFICE_ADMINISTRATOR` when a later migration creates it. It is read by the
-- Role CRUD guards, which refuse to rename, retire or re-grant one of these, and
-- by NOTHING else — authorization never reads it. A flag called "system" on a
-- Role is exactly where an `if (isSystem) allow` bypass would be smuggled in, so
-- that absence is asserted by its own test rather than left to review.
--
-- Scoped by NAME across every organization: Phase 1 adopted or copied these rows
-- per office, so a legacy name matches once per office that uses it. A role an
-- office invents is not matched and stays editable, which is the whole point.

CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "Role"
  ADD COLUMN "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Role" SET "isSystem" = true
WHERE "name" IN (
  'SALES_RELATIONSHIP_OFFICER',
  'PLACEMENT_TECHNICAL_OFFICER',
  'POLICY_CHECKING_OFFICER',
  'CLAIMS_OFFICER',
  'FINANCE_COLLECTIONS_OFFICER',
  'COMPLIANCE_OFFICER',
  'BRANCH_DEPARTMENT_MANAGER',
  'DATA_PROTECTION_OFFICER',
  'SYSTEM_SECURITY_ADMINISTRATOR',
  'EXECUTIVE_MANAGEMENT',
  'EXTERNAL_AUDITOR'
);
