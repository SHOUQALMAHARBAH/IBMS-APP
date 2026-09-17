-- ============================================================================
-- Multi-tenancy Phase 2, step 8 — PostgreSQL Row-Level Security
--
-- Spec §1 layer 2: "Even a raw/forgotten query without the app-layer filter
-- still can't cross tenants, because Postgres itself refuses the rows."
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS INERT UNLESS THE APP CONNECTS AS A NON-OWNER ROLE
-- ---------------------------------------------------------------------------
-- Postgres exempts a table's OWNER from that table's own RLS policies. This
-- database's tables are owned by `ibms`, which is also what migrations and the
-- seed run as — so if the API connected as `ibms`, every policy below would be
-- silently, completely ineffective while looking perfectly correct.
--
-- The API therefore connects as `ibms_app`: a role that owns nothing, holds
-- only SELECT/INSERT/UPDATE/DELETE, and is consequently subject to every policy.
-- `ibms` keeps full unfiltered access, which is what migrations and seeding
-- need — both legitimately touch rows across every Organization at once.
--
-- `ibms_app` is NOT created here. Roles are cluster-level, not database-level,
-- and creating one needs CREATEROLE, which a migration should not require.
-- `npm run db:provision-app-role` creates it; this migration refuses to run
-- without it rather than granting into thin air.
--
-- ---------------------------------------------------------------------------
-- WHY THE POLICIES FAIL CLOSED
-- ---------------------------------------------------------------------------
-- `current_setting('app.current_org_id', true)` returns NULL when the setting is
-- absent, and `"organizationId" = NULL` is NULL, not true — so a connection that
-- never sets it sees NOTHING rather than everything. A bug that forgets to set
-- the variable degrades to "no rows", never to "all tenants' rows".
--
-- WITH CHECK mirrors USING so the same rule governs writes: a row cannot be
-- INSERTed or UPDATEd into another Organization even when its id is named
-- explicitly. Verified against a live database before this was written.
--
-- The application sets the variable per transaction (`SET LOCAL`) —
-- apps/api/src/prisma/tenant-scope.extension.ts. It must be transaction-scoped:
-- on a connection pool, a bare `SET` and the query that follows it can be
-- handed two different connections.
--
-- ---------------------------------------------------------------------------
-- ALSO IN THIS MIGRATION: SecurityConfig stops being a singleton
-- ---------------------------------------------------------------------------
-- It keyed on a fixed row id of 'default'. Harmless with one office — the
-- upsert matched the Phase 1 backfilled row — but a second Organization's
-- first read would have collided on that primary key. Same class of
-- single-tenant assumption step 5 removed from the unique constraints, so it
-- gets the same fix: keyed by organizationId.
--
-- Deliberately NOT included: the same pre-existing-drift statements Phase 1
-- documented (raw-SQL GIN/partial indexes and GENERATED-column defaults that
-- schema.prisma cannot express). Verified unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Refuse to proceed unless the non-owner application role exists.
-- Granting to a missing role would abort anyway; this says why.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ibms_app') THEN
    RAISE EXCEPTION
      'Role "ibms_app" does not exist. Row-level security is pointless without it: the API must connect as a NON-OWNER role, because Postgres exempts a table owner from its own policies. Create it first with "npm run db:provision-app-role" (needs a role with CREATEROLE), then re-run this migration.';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "SecurityConfig" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "SecurityConfig_organizationId_key" ON "SecurityConfig"("organizationId");

-- ---------------------------------------------------------------------------
-- Grants for the application role. No ownership, no DDL, no BYPASSRLS — just
-- enough to read and write rows, which is precisely what makes the policies
-- apply to it.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO ibms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ibms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ibms_app;

-- Tables created by LATER migrations must be reachable too, or the first
-- deploy after this one breaks at runtime rather than at migrate time.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ibms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ibms_app;

-- ---------------------------------------------------------------------------
-- One policy per tenant-scoped table (118 of them).
--
-- The list is derived from schema.prisma by the same rule the runtime uses —
-- "the model has an organizationId field" — so the policies cannot cover a
-- different set of tables than the application layer does. Spec §8: "a missed
-- table is a real isolation hole."
-- ---------------------------------------------------------------------------
ALTER TABLE "AccessAnomalyAlert" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AccessAnomalyAlert"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AccessDeprovisioningChecklist" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AccessDeprovisioningChecklist"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AccessRecertificationCycle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AccessRecertificationCycle"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AccessRecertificationItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AccessRecertificationItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Adjuster" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Adjuster"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Asset"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "AuditLogEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "AuditLogEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "BcpDrPlan" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "BcpDrPlan"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Branch"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "BrokerLicense" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "BrokerLicense"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Cancellation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Cancellation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CertificateOfDestruction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CertificateOfDestruction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Claim"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClaimDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClaimDocument"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClaimFollowUpAlert" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClaimFollowUpAlert"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClaimStatusHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClaimStatusHistory"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClientDecision" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClientDecision"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ClientFundsLedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ClientFundsLedgerEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CommissionAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CommissionAgreement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CommissionLedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CommissionLedgerEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CommissionReversal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CommissionReversal"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CommunicationLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CommunicationLog"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ComparisonMatrix" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ComparisonMatrix"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ComparisonMatrixRow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ComparisonMatrixRow"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Complaint" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Complaint"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ComplaintAction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ComplaintAction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ComplianceCalendarItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ComplianceCalendarItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ConflictOfInterestDisclosure" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ConflictOfInterestDisclosure"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ConsentRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CoverNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CoverNote"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CrossBorderTransferRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrossBorderTransferRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CrossSellOpportunity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CrossSellOpportunity"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Customer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "CustomerFeedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "CustomerFeedback"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DataProcessingAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DataProcessingAgreement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DataSharingApproval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DataSharingApproval"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DataSubjectRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DataSubjectRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DeliveryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DeliveryRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Department"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DisposalBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DisposalBatch"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Document"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DocumentTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DocumentTemplate"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "DpiaScreening" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "DpiaScreening"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Employee"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EmployeePerformanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "EmployeePerformanceRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Endorsement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Endorsement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "EscalationRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "EscalationRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "IncidentReport" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "IncidentReport"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InformationAsset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InformationAsset"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsuranceProgram" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsuranceProgram"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsuranceProgramLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsuranceProgramLine"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsuredPerson" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsuredPerson"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Insurer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Insurer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsurerPerformanceScore" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsurerPerformanceScore"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsurerProduct" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsurerProduct"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InsurerSlaAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsurerSlaAgreement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Interaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Interaction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "InternalAuditFinding" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InternalAuditFinding"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Invoice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "KYCRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "KYCRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "KnowledgeBaseArticle" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "KnowledgeBaseArticle"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Lead"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LegalHold" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "LegalHold"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LossRatio" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "LossRatio"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "MfaCredential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "MfaCredential"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "NeedsAssessment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "NeedsAssessment"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Opportunity"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PasswordHistoryEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PasswordHistoryEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PasswordResetToken"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PaymentChannel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PaymentChannel"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Policy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Policy"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PolicyChecking" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PolicyChecking"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PolicySchedule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PolicySchedule"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PremiumTransaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PremiumTransaction"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PrivacyNotice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "PrivacyNotice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ProfessionalIndemnityPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ProfessionalIndemnityPolicy"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ProfessionalIndemnityRiskEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ProfessionalIndemnityRiskEvent"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Prospect" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Prospect"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Quotation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Quotation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RFQ" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RFQ"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RFQInsurer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RFQInsurer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Receipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Receipt"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Recommendation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Recommendation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ReconciliationException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ReconciliationException"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RefreshToken"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Refund"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Remittance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Remittance"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RenewalCase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RenewalCase"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RenewalRecommendation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RenewalRecommendation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RetentionCase" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RetentionCase"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RetentionScheduleItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RetentionScheduleItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RiskProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RiskProfile"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RiskRating" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RiskRating"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RiskRegisterItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RiskRegisterItem"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RopaEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RopaEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SalesTarget" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SalesTarget"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ScreeningCaseNote" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ScreeningCaseNote"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ScreeningHoldRelease" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ScreeningHoldRelease"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ScreeningMatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ScreeningMatch"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ScreeningRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ScreeningRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ScreeningResult" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ScreeningResult"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SecurityAwarenessTraining" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SecurityAwarenessTraining"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SecurityConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SecurityConfig"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ServiceRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ServiceRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Settlement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Settlement"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SlaHoliday" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SlaHoliday"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SlaPolicy" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SlaPolicy"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SlaPolicyEscalation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SlaPolicyEscalation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "SlaTimer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "SlaTimer"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "ThirdPartyClaimant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "ThirdPartyClaimant"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TransactionMonitoringAlert" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "TransactionMonitoringAlert"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TrustedDevice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "TrustedDevice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "UltimateBeneficialOwner" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UltimateBeneficialOwner"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "UpSellRecommendation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UpSellRecommendation"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "User"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "UserRoleAssignment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UserRoleAssignment"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "UserSession"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Vendor"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
