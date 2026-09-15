-- Part II §4.1 (multi-tenancy Phase 4) — the authentication, MFA and session
-- rebuild.
--
-- No new table, so no new RLS policy is required: every column added here lands
-- on `User` and `UserSession`, both already tenant-scoped and already carrying
-- a `tenant_isolation` policy from migration 20260928100000. The standing rule
-- (Part I §1) applies to new TABLES; this migration adds none, and the policy
-- count is asserted unchanged at the end rather than assumed.

-- CreateEnum
CREATE TYPE "MfaMethod" AS ENUM ('TOTP_APP', 'SMS', 'EMAIL');

-- ---------------------------------------------------------------------------
-- User — the onboarding and MFA lifecycle.
--
-- `mustChangePassword` is added with DEFAULT true because an admin-provisioned
-- account is the case that must never be forgotten. It is then backfilled to
-- FALSE for every row that already exists: those people have been using
-- passwords they chose themselves, and flipping all of them into forced
-- rotation would lock every existing user out of the system on deploy.
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "mfaMethod"            "MfaMethod",
  ADD COLUMN "mfaEnrolledAt"        TIMESTAMP(3),
  ADD COLUMN "mfaEnrollmentPending" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "mustChangePassword" = false;

-- A user who already completed TOTP enrolment before this phase keeps that
-- fact: they have a working authenticator app, and forcing them back through
-- enrolment would invalidate it for no reason.
UPDATE "User" u
   SET "mfaMethod"     = 'TOTP_APP',
       "mfaEnrolledAt" = COALESCE(u."mfaEnrolledAt", c."createdAt")
  FROM "MfaCredential" c
 WHERE c."userId" = u.id
   AND c.type = 'TOTP'
   AND c."isActive" = true
   AND u."mfaEnabled" = true;

-- ---------------------------------------------------------------------------
-- UserSession — idle vs absolute expiry (§4.1.5).
--
-- The pre-existing single `expiresAt` was the absolute cap, so it seeds
-- `absoluteExpiresAt` directly. `idleExpiresAt` is seeded from the session's
-- last activity plus the office's own configured idle timeout, so a session
-- that is ALREADY idle past that point stays expired across this migration
-- rather than being silently granted a fresh window by the deploy.
-- ---------------------------------------------------------------------------
ALTER TABLE "UserSession"
  ADD COLUMN "idleExpiresAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- First pass: the schema default of 15 minutes, for any office that has not
-- configured its own.
UPDATE "UserSession" s
   SET "absoluteExpiresAt" = s."expiresAt",
       "idleExpiresAt" = s."lastActivityAt" + make_interval(mins => 15);

-- Second pass: the office's own configured idle timeout, where one exists.
UPDATE "UserSession" s
   SET "idleExpiresAt" = s."lastActivityAt"
         + make_interval(mins => cfg."idleTimeoutMinutes")
  FROM "SecurityConfig" cfg
 WHERE cfg."organizationId" = s."organizationId";

-- ---------------------------------------------------------------------------
-- Guard rails.
-- ---------------------------------------------------------------------------
DO $$
DECLARE stranded integer; policies integer;
BEGIN
  -- Nobody should be left needing a password change they were never given a
  -- temporary password for.
  SELECT count(*) INTO stranded FROM "User" WHERE "mustChangePassword" = true;
  IF stranded > 0 THEN
    RAISE EXCEPTION
      'Backfill left % pre-existing user(s) flagged mustChangePassword; they would be locked out on deploy',
      stranded;
  END IF;

  -- This migration adds no table, so the policy count must be exactly what
  -- Phase 3 left behind. A change here means a table was added without one.
  SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'public';
  IF policies <> 119 THEN
    RAISE EXCEPTION
      'Expected 119 RLS policies, found % — a tenant-scoped table may have been added without one',
      policies;
  END IF;
END $$;
