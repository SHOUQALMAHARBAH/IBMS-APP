-- Part I §6 (multi-tenancy Phase 3 step 11) — the per-Organization outbound
-- mailbox, connected by OAuth.
--
-- One row per office, holding the mailbox address every outbound message is
-- sent FROM and the encrypted OAuth refresh token used to obtain access tokens.
-- The platform never sends mail as itself.
--
-- THIS TABLE IS TENANT-SCOPED, so unlike the three global tables added by
-- 20260929100000 it needs an RLS policy of its own. Migration 20260928100000
-- installed policies for the 118 tables that existed when it ran; it cannot
-- cover a table added afterwards. Spec §8 is blunt about why that matters —
-- "a missed table is a real isolation hole" — and an office's mailbox
-- credential is about the worst row in this system to leave unprotected.
--
-- Every table added from here on must do the same. The application layer picks
-- new tenant tables up automatically (the extension reads the Prisma DMMF at
-- startup); the database layer does not.

-- CreateEnum
CREATE TYPE "EmailProviderKind" AS ENUM ('MICROSOFT365', 'GOOGLE_WORKSPACE');
CREATE TYPE "EmailIntegrationStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ERROR');

-- CreateTable
CREATE TABLE "OrganizationEmailIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "EmailProviderKind" NOT NULL,
    "connectedEmail" TEXT NOT NULL,
    "oauthRefreshTokenEnc" TEXT NOT NULL,
    "providerTenantId" TEXT,
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "status" "EmailIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationEmailIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationEmailIntegration_organizationId_key" ON "OrganizationEmailIntegration"("organizationId");
CREATE INDEX "OrganizationEmailIntegration_organizationId_idx" ON "OrganizationEmailIntegration"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationEmailIntegration" ADD CONSTRAINT "OrganizationEmailIntegration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Layer 2. Same policy shape as every other tenant-scoped table.
-- ---------------------------------------------------------------------------
ALTER TABLE "OrganizationEmailIntegration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OrganizationEmailIntegration"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "OrganizationEmailIntegration" TO ibms_app;

-- Refuse to finish if the policy did not take. A table that silently ends up
-- without one reads across offices for as long as nobody checks, and this
-- particular table holds mailbox credentials.
DO $$
DECLARE enabled boolean; policies integer;
BEGIN
  SELECT c.relrowsecurity INTO enabled
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'OrganizationEmailIntegration';
  SELECT count(*) INTO policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'OrganizationEmailIntegration';
  IF NOT enabled OR policies < 1 THEN
    RAISE EXCEPTION
      'OrganizationEmailIntegration is missing row-level security (enabled=%, policies=%)',
      enabled, policies;
  END IF;
END $$;
