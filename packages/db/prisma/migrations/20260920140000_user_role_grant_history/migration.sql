-- Part 10.1 — keep the role-grant HISTORY that UserRoleAssignment.revokedAt
-- exists to record.
--
-- The schema comment on that column says a revoked row "is kept (not deleted)
-- as the audit record of when/that access was withdrawn". It was not kept in
-- any meaningful sense: `@@unique([userId, roleId])` allows exactly ONE row
-- per pair, so `grantRole` upserted onto it with
-- `update: { revokedAt: null, grantedAt: new Date() }`. Re-granting a role a
-- user had previously held ERASED the revocation timestamp and overwrote the
-- original grant date, destroying the very record the column is for. "User X
-- held FINANCE_OFFICER from A to B" survived only in AuditLogEntry.
--
-- The invariant that actually matters is "at most one ACTIVE grant per
-- (user, role)" — which is a PARTIAL unique. Revoked rows are history and
-- should be unlimited.
--
-- Prisma cannot express `WHERE "revokedAt" IS NULL`, so the constraint lives
-- here in raw SQL and the model carries a NOTE instead of an `@@unique`.
-- Same treatment as PolicySchedule_one_open_per_policy and
-- Endorsement_one_live_cancellation_per_policy.

-- Prisma materialises a scalar/compound `@@unique` as a unique INDEX, not a
-- table CONSTRAINT — so this must be DROP INDEX, not DROP CONSTRAINT. (A
-- `DROP CONSTRAINT IF EXISTS` here would silently no-op and leave the old
-- index in place, which is exactly the trap migration 20260909160000
-- documents for Receipt_invoiceId_key.)
DROP INDEX IF EXISTS "UserRoleAssignment_userId_roleId_key";

-- Defensive: if any (userId, roleId) somehow already holds more than one
-- ACTIVE grant, keep the earliest and revoke the rest, so the partial unique
-- below can be created. The dropped constraint made this impossible in
-- practice; this is here so the migration cannot fail halfway on a database
-- that got into that state another way.
UPDATE "UserRoleAssignment" a
   SET "revokedAt" = now()
 WHERE a."revokedAt" IS NULL
   AND EXISTS (
     SELECT 1 FROM "UserRoleAssignment" b
      WHERE b."userId" = a."userId"
        AND b."roleId" = a."roleId"
        AND b."revokedAt" IS NULL
        AND (b."grantedAt" < a."grantedAt"
             OR (b."grantedAt" = a."grantedAt" AND b."id" < a."id"))
   );

CREATE UNIQUE INDEX IF NOT EXISTS "UserRoleAssignment_one_active_per_user_role"
  ON "UserRoleAssignment" ("userId", "roleId")
  WHERE "revokedAt" IS NULL;

-- Reading a user's grant history, and the common "is this grant active?" read.
CREATE INDEX IF NOT EXISTS "UserRoleAssignment_userId_roleId_idx"
  ON "UserRoleAssignment" ("userId", "roleId");
