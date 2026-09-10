-- ============================================================================
-- Multi-tenancy Phase 1 — Organization foundation (schema + backfill only)
--
-- Implements Part VI Phase 1 of the multi-tenant architecture spec:
--   1. the Organization model (§2) + OrgStatus enum
--   2. organizationId on all 112 tenant-scoped models (§3.2), plus the three
--      new Part II models this migration also creates (Department,
--      TrustedDevice, PasswordHistoryEntry). UserSession already existed and
--      is scoped like any other table.
--   3. exactly ONE Organization row, with every existing row backfilled onto
--      it via the column default
--   4. User.email uniqueness: global -> ("organizationId", "email") (§4.1.3)
--
-- Six models stay GLOBAL, per spec §3.1: Role, Permission, RolePermission
-- (the shared 11-role catalogue), and WatchlistEntry / WatchlistDatasetVersion
-- / WatchlistSyncRun (the OFAC/UN sanctions cache — public reference data,
-- identical for every office). InsurerMaster/InsurerFormTemplate/
-- InsurerFormField are also global per §3.1 but do not exist yet; they arrive
-- in Phase 3.
--
-- NOTHING IS ENFORCED YET. The org-scoping interceptor and the PostgreSQL
-- Row-Level Security policies are Phase 2. This migration only makes it
-- possible to say which office a row belongs to.
--
-- Deliberately NOT included, and still outstanding after this migration:
--   * The pre-existing index-name drift on ScreeningMatch's compound unique
--     (Prisma computes a truncated name; migration 20260920100000 created the
--     untruncated one). Unrelated to multi-tenancy — not folded in here.
--   * Eleven other statements `prisma migrate diff` wanted to emit, all of
--     which would have UNDONE shipped raw-SQL work Prisma cannot model:
--     DROP INDEX on the three searchVector GIN indexes, the canonicalTokens
--     GIN index, and four partial/compound screening indexes; DROP DEFAULT on
--     the three searchVector GENERATED columns (Postgres refuses this outright)
--     and on WatchlistEntry.canonicalTokens. All deliberately excluded.
--   * Global unique constraints on tenant-scoped tables that will collide once
--     a second Organization exists: RetentionScheduleItem.recordCategory,
--     PrivacyNotice(touchpoint, versionNumber), Policy.policyNumber,
--     Claim.claimNumber, ScreeningRequest.idempotencyKey. Only User.email was
--     in Phase 1's scope (§4.1.3); the rest are a Phase 2 decision.
-- ============================================================================

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "AccessAnomalyAlert" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "AccessDeprovisioningChecklist" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "AccessRecertificationCycle" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "AccessRecertificationItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Adjuster" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "AuditLogEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "BcpDrPlan" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "BrokerLicense" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Cancellation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CertificateOfDestruction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ClaimDocument" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ClaimFollowUpAlert" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ClaimStatusHistory" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ClientDecision" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ClientFundsLedgerEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CommissionAgreement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CommissionLedgerEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CommissionReversal" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CommunicationLog" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ComparisonMatrix" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ComparisonMatrixRow" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ComplaintAction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ComplianceCalendarItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ConflictOfInterestDisclosure" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ConsentRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CoverNote" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CrossBorderTransferRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CrossSellOpportunity" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "CustomerFeedback" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DataProcessingAgreement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DataSharingApproval" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DataSubjectRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DeliveryRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DisposalBatch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DocumentTemplate" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "DpiaScreening" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "EmployeePerformanceRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Endorsement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "EscalationRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "IncidentReport" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InformationAsset" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsuranceProgram" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsuranceProgramLine" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsuredPerson" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Insurer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsurerPerformanceScore" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsurerProduct" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InsurerSlaAgreement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "InternalAuditFinding" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "KYCRecord" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "KnowledgeBaseArticle" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "LegalHold" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "LossRatio" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "MfaCredential" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "NeedsAssessment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PaymentChannel" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PolicyChecking" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PolicySchedule" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PremiumTransaction" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "PrivacyNotice" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ProfessionalIndemnityPolicy" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ProfessionalIndemnityRiskEvent" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RFQ" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RFQInsurer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ReconciliationException" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Remittance" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RenewalCase" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RenewalRecommendation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RetentionCase" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RetentionScheduleItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RiskProfile" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RiskRating" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RiskRegisterItem" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "RopaEntry" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SalesTarget" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ScreeningCaseNote" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ScreeningHoldRelease" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ScreeningMatch" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ScreeningRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ScreeningResult" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SecurityAwarenessTraining" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SecurityConfig" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "SlaTimer" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "ThirdPartyClaimant" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "TransactionMonitoringAlert" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "UltimateBeneficialOwner" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "UpSellRecommendation" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "UserRoleAssignment" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "UserSession" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalNameAr" TEXT,
    "brokerLicenseNumber" TEXT,
    "subdomain" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "dpoAlternateApproverUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Backfill (spec Part VI Phase 1, step 3)
--
-- Every tenant-scoped column above was added as
--     "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
-- so Postgres has already stamped every pre-existing row with this id. This
-- INSERT creates the row that id points at. It MUST run before the foreign
-- keys at the end of this file, or every one of them fails validation.
--
-- The id is a fixed, well-known constant rather than a generated uuid so that
-- the column default, this row, and prisma/seed.ts all agree without anything
-- having to read the database first. prisma/seed.ts upserts the same id.
--
-- ON CONFLICT DO NOTHING: a database that already has this row (a re-run, or a
-- restore taken after the seed) is left exactly as it is, never overwritten.
-- ---------------------------------------------------------------------------
INSERT INTO "Organization" ("id", "legalName", "legalNameAr", "subdomain", "status", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Brokerage Office',
  'مكتب الوساطة الافتراضي',
  'default',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "userId" TEXT NOT NULL,
    "deviceFingerprintHash" TEXT NOT NULL,
    "label" TEXT,
    "firstSeenIp" TEXT,
    "trustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordHistoryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_subdomain_key" ON "Organization"("subdomain");

-- CreateIndex
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");

-- CreateIndex
CREATE INDEX "TrustedDevice_userId_idx" ON "TrustedDevice"("userId");

-- CreateIndex
CREATE INDEX "TrustedDevice_organizationId_idx" ON "TrustedDevice"("organizationId");

-- CreateIndex
CREATE INDEX "PasswordHistoryEntry_userId_idx" ON "PasswordHistoryEntry"("userId");

-- CreateIndex
CREATE INDEX "PasswordHistoryEntry_organizationId_idx" ON "PasswordHistoryEntry"("organizationId");

-- CreateIndex
CREATE INDEX "AccessAnomalyAlert_organizationId_idx" ON "AccessAnomalyAlert"("organizationId");

-- CreateIndex
CREATE INDEX "AccessDeprovisioningChecklist_organizationId_idx" ON "AccessDeprovisioningChecklist"("organizationId");

-- CreateIndex
CREATE INDEX "AccessRecertificationCycle_organizationId_idx" ON "AccessRecertificationCycle"("organizationId");

-- CreateIndex
CREATE INDEX "AccessRecertificationItem_organizationId_idx" ON "AccessRecertificationItem"("organizationId");

-- CreateIndex
CREATE INDEX "Adjuster_organizationId_idx" ON "Adjuster"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_organizationId_idx" ON "AuditLogEntry"("organizationId");

-- CreateIndex
CREATE INDEX "BcpDrPlan_organizationId_idx" ON "BcpDrPlan"("organizationId");

-- CreateIndex
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");

-- CreateIndex
CREATE INDEX "BrokerLicense_organizationId_idx" ON "BrokerLicense"("organizationId");

-- CreateIndex
CREATE INDEX "Cancellation_organizationId_idx" ON "Cancellation"("organizationId");

-- CreateIndex
CREATE INDEX "CertificateOfDestruction_organizationId_idx" ON "CertificateOfDestruction"("organizationId");

-- CreateIndex
CREATE INDEX "Claim_organizationId_idx" ON "Claim"("organizationId");

-- CreateIndex
CREATE INDEX "ClaimDocument_organizationId_idx" ON "ClaimDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ClaimFollowUpAlert_organizationId_idx" ON "ClaimFollowUpAlert"("organizationId");

-- CreateIndex
CREATE INDEX "ClaimStatusHistory_organizationId_idx" ON "ClaimStatusHistory"("organizationId");

-- CreateIndex
CREATE INDEX "ClientDecision_organizationId_idx" ON "ClientDecision"("organizationId");

-- CreateIndex
CREATE INDEX "ClientFundsLedgerEntry_organizationId_idx" ON "ClientFundsLedgerEntry"("organizationId");

-- CreateIndex
CREATE INDEX "CommissionAgreement_organizationId_idx" ON "CommissionAgreement"("organizationId");

-- CreateIndex
CREATE INDEX "CommissionLedgerEntry_organizationId_idx" ON "CommissionLedgerEntry"("organizationId");

-- CreateIndex
CREATE INDEX "CommissionReversal_organizationId_idx" ON "CommissionReversal"("organizationId");

-- CreateIndex
CREATE INDEX "CommunicationLog_organizationId_idx" ON "CommunicationLog"("organizationId");

-- CreateIndex
CREATE INDEX "ComparisonMatrix_organizationId_idx" ON "ComparisonMatrix"("organizationId");

-- CreateIndex
CREATE INDEX "ComparisonMatrixRow_organizationId_idx" ON "ComparisonMatrixRow"("organizationId");

-- CreateIndex
CREATE INDEX "Complaint_organizationId_idx" ON "Complaint"("organizationId");

-- CreateIndex
CREATE INDEX "ComplaintAction_organizationId_idx" ON "ComplaintAction"("organizationId");

-- CreateIndex
CREATE INDEX "ComplianceCalendarItem_organizationId_idx" ON "ComplianceCalendarItem"("organizationId");

-- CreateIndex
CREATE INDEX "ConflictOfInterestDisclosure_organizationId_idx" ON "ConflictOfInterestDisclosure"("organizationId");

-- CreateIndex
CREATE INDEX "ConsentRecord_organizationId_idx" ON "ConsentRecord"("organizationId");

-- CreateIndex
CREATE INDEX "CoverNote_organizationId_idx" ON "CoverNote"("organizationId");

-- CreateIndex
CREATE INDEX "CrossBorderTransferRecord_organizationId_idx" ON "CrossBorderTransferRecord"("organizationId");

-- CreateIndex
CREATE INDEX "CrossSellOpportunity_organizationId_idx" ON "CrossSellOpportunity"("organizationId");

-- CreateIndex
CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");

-- CreateIndex
CREATE INDEX "CustomerFeedback_organizationId_idx" ON "CustomerFeedback"("organizationId");

-- CreateIndex
CREATE INDEX "DataProcessingAgreement_organizationId_idx" ON "DataProcessingAgreement"("organizationId");

-- CreateIndex
CREATE INDEX "DataSharingApproval_organizationId_idx" ON "DataSharingApproval"("organizationId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_organizationId_idx" ON "DataSubjectRequest"("organizationId");

-- CreateIndex
CREATE INDEX "DeliveryRecord_organizationId_idx" ON "DeliveryRecord"("organizationId");

-- CreateIndex
CREATE INDEX "DisposalBatch_organizationId_idx" ON "DisposalBatch"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentTemplate_organizationId_idx" ON "DocumentTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "DpiaScreening_organizationId_idx" ON "DpiaScreening"("organizationId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_organizationId_idx" ON "Employee"("organizationId");

-- CreateIndex
CREATE INDEX "EmployeePerformanceRecord_organizationId_idx" ON "EmployeePerformanceRecord"("organizationId");

-- CreateIndex
CREATE INDEX "Endorsement_organizationId_idx" ON "Endorsement"("organizationId");

-- CreateIndex
CREATE INDEX "EscalationRecord_organizationId_idx" ON "EscalationRecord"("organizationId");

-- CreateIndex
CREATE INDEX "IncidentReport_organizationId_idx" ON "IncidentReport"("organizationId");

-- CreateIndex
CREATE INDEX "InformationAsset_organizationId_idx" ON "InformationAsset"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceProgram_organizationId_idx" ON "InsuranceProgram"("organizationId");

-- CreateIndex
CREATE INDEX "InsuranceProgramLine_organizationId_idx" ON "InsuranceProgramLine"("organizationId");

-- CreateIndex
CREATE INDEX "InsuredPerson_organizationId_idx" ON "InsuredPerson"("organizationId");

-- CreateIndex
CREATE INDEX "Insurer_organizationId_idx" ON "Insurer"("organizationId");

-- CreateIndex
CREATE INDEX "InsurerPerformanceScore_organizationId_idx" ON "InsurerPerformanceScore"("organizationId");

-- CreateIndex
CREATE INDEX "InsurerProduct_organizationId_idx" ON "InsurerProduct"("organizationId");

-- CreateIndex
CREATE INDEX "InsurerSlaAgreement_organizationId_idx" ON "InsurerSlaAgreement"("organizationId");

-- CreateIndex
CREATE INDEX "Interaction_organizationId_idx" ON "Interaction"("organizationId");

-- CreateIndex
CREATE INDEX "InternalAuditFinding_organizationId_idx" ON "InternalAuditFinding"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "KYCRecord_organizationId_idx" ON "KYCRecord"("organizationId");

-- CreateIndex
CREATE INDEX "KnowledgeBaseArticle_organizationId_idx" ON "KnowledgeBaseArticle"("organizationId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_idx" ON "Lead"("organizationId");

-- CreateIndex
CREATE INDEX "LegalHold_organizationId_idx" ON "LegalHold"("organizationId");

-- CreateIndex
CREATE INDEX "LossRatio_organizationId_idx" ON "LossRatio"("organizationId");

-- CreateIndex
CREATE INDEX "MfaCredential_organizationId_idx" ON "MfaCredential"("organizationId");

-- CreateIndex
CREATE INDEX "NeedsAssessment_organizationId_idx" ON "NeedsAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "Opportunity_organizationId_idx" ON "Opportunity"("organizationId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_organizationId_idx" ON "PasswordResetToken"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentChannel_organizationId_idx" ON "PaymentChannel"("organizationId");

-- CreateIndex
CREATE INDEX "Policy_organizationId_idx" ON "Policy"("organizationId");

-- CreateIndex
CREATE INDEX "PolicyChecking_organizationId_idx" ON "PolicyChecking"("organizationId");

-- CreateIndex
CREATE INDEX "PolicySchedule_organizationId_idx" ON "PolicySchedule"("organizationId");

-- CreateIndex
CREATE INDEX "PremiumTransaction_organizationId_idx" ON "PremiumTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "PrivacyNotice_organizationId_idx" ON "PrivacyNotice"("organizationId");

-- CreateIndex
CREATE INDEX "ProfessionalIndemnityPolicy_organizationId_idx" ON "ProfessionalIndemnityPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "ProfessionalIndemnityRiskEvent_organizationId_idx" ON "ProfessionalIndemnityRiskEvent"("organizationId");

-- CreateIndex
CREATE INDEX "Prospect_organizationId_idx" ON "Prospect"("organizationId");

-- CreateIndex
CREATE INDEX "Quotation_organizationId_idx" ON "Quotation"("organizationId");

-- CreateIndex
CREATE INDEX "RFQ_organizationId_idx" ON "RFQ"("organizationId");

-- CreateIndex
CREATE INDEX "RFQInsurer_organizationId_idx" ON "RFQInsurer"("organizationId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_idx" ON "Receipt"("organizationId");

-- CreateIndex
CREATE INDEX "Recommendation_organizationId_idx" ON "Recommendation"("organizationId");

-- CreateIndex
CREATE INDEX "ReconciliationException_organizationId_idx" ON "ReconciliationException"("organizationId");

-- CreateIndex
CREATE INDEX "RefreshToken_organizationId_idx" ON "RefreshToken"("organizationId");

-- CreateIndex
CREATE INDEX "Refund_organizationId_idx" ON "Refund"("organizationId");

-- CreateIndex
CREATE INDEX "Remittance_organizationId_idx" ON "Remittance"("organizationId");

-- CreateIndex
CREATE INDEX "RenewalCase_organizationId_idx" ON "RenewalCase"("organizationId");

-- CreateIndex
CREATE INDEX "RenewalRecommendation_organizationId_idx" ON "RenewalRecommendation"("organizationId");

-- CreateIndex
CREATE INDEX "RetentionCase_organizationId_idx" ON "RetentionCase"("organizationId");

-- CreateIndex
CREATE INDEX "RetentionScheduleItem_organizationId_idx" ON "RetentionScheduleItem"("organizationId");

-- CreateIndex
CREATE INDEX "RiskProfile_organizationId_idx" ON "RiskProfile"("organizationId");

-- CreateIndex
CREATE INDEX "RiskRating_organizationId_idx" ON "RiskRating"("organizationId");

-- CreateIndex
CREATE INDEX "RiskRegisterItem_organizationId_idx" ON "RiskRegisterItem"("organizationId");

-- CreateIndex
CREATE INDEX "RopaEntry_organizationId_idx" ON "RopaEntry"("organizationId");

-- CreateIndex
CREATE INDEX "SalesTarget_organizationId_idx" ON "SalesTarget"("organizationId");

-- CreateIndex
CREATE INDEX "ScreeningCaseNote_organizationId_idx" ON "ScreeningCaseNote"("organizationId");

-- CreateIndex
CREATE INDEX "ScreeningHoldRelease_organizationId_idx" ON "ScreeningHoldRelease"("organizationId");

-- CreateIndex
CREATE INDEX "ScreeningMatch_organizationId_idx" ON "ScreeningMatch"("organizationId");

-- CreateIndex
CREATE INDEX "ScreeningRequest_organizationId_idx" ON "ScreeningRequest"("organizationId");

-- CreateIndex
CREATE INDEX "ScreeningResult_organizationId_idx" ON "ScreeningResult"("organizationId");

-- CreateIndex
CREATE INDEX "SecurityAwarenessTraining_organizationId_idx" ON "SecurityAwarenessTraining"("organizationId");

-- CreateIndex
CREATE INDEX "SecurityConfig_organizationId_idx" ON "SecurityConfig"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceRequest_organizationId_idx" ON "ServiceRequest"("organizationId");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_idx" ON "Settlement"("organizationId");

-- CreateIndex
CREATE INDEX "SlaTimer_organizationId_idx" ON "SlaTimer"("organizationId");

-- CreateIndex
CREATE INDEX "ThirdPartyClaimant_organizationId_idx" ON "ThirdPartyClaimant"("organizationId");

-- CreateIndex
CREATE INDEX "TransactionMonitoringAlert_organizationId_idx" ON "TransactionMonitoringAlert"("organizationId");

-- CreateIndex
CREATE INDEX "UltimateBeneficialOwner_organizationId_idx" ON "UltimateBeneficialOwner"("organizationId");

-- CreateIndex
CREATE INDEX "UpSellRecommendation_organizationId_idx" ON "UpSellRecommendation"("organizationId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE INDEX "UserRoleAssignment_organizationId_idx" ON "UserRoleAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "UserSession_organizationId_idx" ON "UserSession"("organizationId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_idx" ON "Vendor"("organizationId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordHistoryEntry" ADD CONSTRAINT "PasswordHistoryEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordHistoryEntry" ADD CONSTRAINT "PasswordHistoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityConfig" ADD CONSTRAINT "SecurityConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecertificationCycle" ADD CONSTRAINT "AccessRecertificationCycle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecertificationItem" ADD CONSTRAINT "AccessRecertificationItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAwarenessTraining" ADD CONSTRAINT "SecurityAwarenessTraining_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDeprovisioningChecklist" ADD CONSTRAINT "AccessDeprovisioningChecklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UltimateBeneficialOwner" ADD CONSTRAINT "UltimateBeneficialOwner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredPerson" ADD CONSTRAINT "InsuredPerson_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KYCRecord" ADD CONSTRAINT "KYCRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningRequest" ADD CONSTRAINT "ScreeningRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRating" ADD CONSTRAINT "RiskRating_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossSellOpportunity" ADD CONSTRAINT "CrossSellOpportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpSellRecommendation" ADD CONSTRAINT "UpSellRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskProfile" ADD CONSTRAINT "RiskProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedsAssessment" ADD CONSTRAINT "NeedsAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceProgram" ADD CONSTRAINT "InsuranceProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceProgramLine" ADD CONSTRAINT "InsuranceProgramLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQInsurer" ADD CONSTRAINT "RFQInsurer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonMatrix" ADD CONSTRAINT "ComparisonMatrix_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonMatrixRow" ADD CONSTRAINT "ComparisonMatrixRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterestDisclosure" ADD CONSTRAINT "ConflictOfInterestDisclosure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDecision" ADD CONSTRAINT "ClientDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySchedule" ADD CONSTRAINT "PolicySchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverNote" ADD CONSTRAINT "CoverNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyChecking" ADD CONSTRAINT "PolicyChecking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReversal" ADD CONSTRAINT "CommissionReversal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDocument" ADD CONSTRAINT "ClaimDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimStatusHistory" ADD CONSTRAINT "ClaimStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThirdPartyClaimant" ADD CONSTRAINT "ThirdPartyClaimant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjuster" ADD CONSTRAINT "Adjuster_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUpAlert" ADD CONSTRAINT "ClaimFollowUpAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumTransaction" ADD CONSTRAINT "PremiumTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentChannel" ADD CONSTRAINT "PaymentChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAgreement" ADD CONSTRAINT "CommissionAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerEntry" ADD CONSTRAINT "CommissionLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationException" ADD CONSTRAINT "ReconciliationException_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFundsLedgerEntry" ADD CONSTRAINT "ClientFundsLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintAction" ADD CONSTRAINT "ComplaintAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRecord" ADD CONSTRAINT "EscalationRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationLog" ADD CONSTRAINT "CommunicationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionCase" ADD CONSTRAINT "RetentionCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalCase" ADD CONSTRAINT "RenewalCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRatio" ADD CONSTRAINT "LossRatio_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalRecommendation" ADD CONSTRAINT "RenewalRecommendation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokerLicense" ADD CONSTRAINT "BrokerLicense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalIndemnityPolicy" ADD CONSTRAINT "ProfessionalIndemnityPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalIndemnityRiskEvent" ADD CONSTRAINT "ProfessionalIndemnityRiskEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionMonitoringAlert" ADD CONSTRAINT "TransactionMonitoringAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningCaseNote" ADD CONSTRAINT "ScreeningCaseNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceCalendarItem" ADD CONSTRAINT "ComplianceCalendarItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRegisterItem" ADD CONSTRAINT "RiskRegisterItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditFinding" ADD CONSTRAINT "InternalAuditFinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InformationAsset" ADD CONSTRAINT "InformationAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionScheduleItem" ADD CONSTRAINT "RetentionScheduleItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisposalBatch" ADD CONSTRAINT "DisposalBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfDestruction" ADD CONSTRAINT "CertificateOfDestruction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossBorderTransferRecord" ADD CONSTRAINT "CrossBorderTransferRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataProcessingAgreement" ADD CONSTRAINT "DataProcessingAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSharingApproval" ADD CONSTRAINT "DataSharingApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DpiaScreening" ADD CONSTRAINT "DpiaScreening_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyNotice" ADD CONSTRAINT "PrivacyNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RopaEntry" ADD CONSTRAINT "RopaEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurerPerformanceScore" ADD CONSTRAINT "InsurerPerformanceScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePerformanceRecord" ADD CONSTRAINT "EmployeePerformanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BcpDrPlan" ADD CONSTRAINT "BcpDrPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeBaseArticle" ADD CONSTRAINT "KnowledgeBaseArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurerProduct" ADD CONSTRAINT "InsurerProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurerSlaAgreement" ADD CONSTRAINT "InsurerSlaAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessAnomalyAlert" ADD CONSTRAINT "AccessAnomalyAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTimer" ADD CONSTRAINT "SlaTimer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningHoldRelease" ADD CONSTRAINT "ScreeningHoldRelease_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
