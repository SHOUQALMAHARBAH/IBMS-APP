-- Role deletion, and why it is a SOFT delete.
--
-- The owner's decision is a set of BEHAVIOURS: deleting a role removes it and its effect
-- immediately, there is no "reassign first" gate, a user left with zero permissions is an accepted
-- outcome, and the historical record of who held what survives, marked revoked.
--
-- A hard DELETE of the Role row cannot satisfy the last one. Measured on this database:
--
--   UserRoleAssignment_roleId_fkey
--       FOREIGN KEY ("roleId") REFERENCES "Role"(id) ON UPDATE CASCADE ON DELETE RESTRICT
--
-- RESTRICT, not CASCADE and not SET NULL. So a hard delete FAILS outright the moment anyone holds
-- the role — which is the only case that matters — and the alternatives are worse: CASCADE would
-- destroy the history the owner asked to keep, and SET NULL would keep rows that no longer name
-- which role they were. Loosening that FK to make a hard delete possible would be choosing the
-- mechanism over the decision.
--
-- So the row survives and carries `deletedAt`. Every behaviour above still holds, and one
-- consequence follows that is worth stating rather than discovering: a deleted role's machine name
-- stays taken, because the row that holds the history also holds the name. That is correct — the
-- machine name is immutable and appears in audit rows, so allowing a second, different role to
-- reuse it would make two roles indistinguishable in the log.
--
-- The effect vanishes STRUCTURALLY rather than by filtering: deletion removes the `RolePermission`
-- rows, so no read path can resolve a permission from a deleted role even if one forgets to check
-- `deletedAt`. There are fourteen Role/assignment read sites in the repositories; a design that
-- depended on all fourteen remembering a filter is the shape this codebase has been bitten by
-- before.
ALTER TABLE "Role" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Partial, because the only queries that need it are "the roles that still exist".
CREATE INDEX "Role_deletedAt_idx" ON "Role" ("organizationId") WHERE "deletedAt" IS NULL;

-- A deleted role must not be reactivated back into service: reactivation is the way back from
-- RETIRED, and delete is deliberately not reversible. Enforced here rather than only in the
-- service, so it holds for any future writer.
ALTER TABLE "Role"
  ADD CONSTRAINT "Role_deleted_is_inactive"
  CHECK ("deletedAt" IS NULL OR "status" = 'INACTIVE');
