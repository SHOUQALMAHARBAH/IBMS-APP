-- ============================================================================
-- Multi-tenancy Phase 2, step 7 — drop the temporary organizationId DEFAULT
--
-- Phase 1 gave every tenant-scoped `organizationId` a column default of the
-- single seeded Organization. That was deliberate and temporary: it made the
-- column NOT NULL from the first migration, backfilled every pre-existing row
-- inside the same ALTER TABLE, and kept every existing .create() call site
-- compiling — which is what let Phase 1 be "schema + backfill, no application
-- change".
--
-- From Phase 2 it becomes a hazard rather than a convenience. The spec is
-- explicit: "any write path this phase's audit missed would silently succeed
-- with the default org's id instead of failing loudly, masking exactly the kind
-- of gap this phase exists to catch."
--
-- What supplies it now: `tenantScopeExtension`
-- (apps/api/src/prisma/tenant-scope.extension.ts) injects `organizationId`
-- into every query against every tenant-scoped model — including nested
-- relation writes — and REFUSES to run one at all when no Organization is in
-- context. The model list is read from the Prisma DMMF rather than hand-kept,
-- so a future tenant-scoped model is covered the moment it is generated.
--
-- The only writer that still names it explicitly is prisma/seed.ts, which runs
-- outside the API and therefore outside the extension.
--
-- This migration changes no data and drops no constraint: the columns stay
-- NOT NULL, every existing row keeps the Organization it already had. It only
-- removes the fallback for FUTURE inserts that fail to name one.
--
-- Deliberately NOT included: the same pre-existing-drift statements Phase 1
-- documented (DROP INDEX on the searchVector/canonicalTokens GIN indexes and
-- four screening indexes, DROP DEFAULT on the three searchVector GENERATED
-- columns — which Postgres refuses outright — and on
-- WatchlistEntry.canonicalTokens, plus one unrelated index rename). Verified
-- unchanged by this migration.
-- ============================================================================

-- AlterTable
ALTER TABLE "AccessAnomalyAlert" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AccessDeprovisioningChecklist" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AccessRecertificationCycle" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AccessRecertificationItem" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Adjuster" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AuditLogEntry" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BcpDrPlan" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BrokerLicense" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Cancellation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CertificateOfDestruction" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Claim" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClaimDocument" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClaimFollowUpAlert" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClaimStatusHistory" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClientDecision" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ClientFundsLedgerEntry" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommissionAgreement" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommissionLedgerEntry" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommissionReversal" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommunicationLog" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ComparisonMatrix" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ComparisonMatrixRow" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Complaint" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ComplaintAction" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ComplianceCalendarItem" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConflictOfInterestDisclosure" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ConsentRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CoverNote" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CrossBorderTransferRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CrossSellOpportunity" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerFeedback" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DataProcessingAgreement" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DataSharingApproval" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DataSubjectRequest" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DeliveryRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DisposalBatch" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Document" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DocumentTemplate" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DpiaScreening" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmployeePerformanceRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Endorsement" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EscalationRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "IncidentReport" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InformationAsset" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsuranceProgram" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsuranceProgramLine" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsuredPerson" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Insurer" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsurerPerformanceScore" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsurerProduct" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InsurerSlaAgreement" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Interaction" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "InternalAuditFinding" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "KYCRecord" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "KnowledgeBaseArticle" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Lead" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LegalHold" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LossRatio" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MfaCredential" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NeedsAssessment" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Opportunity" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasswordHistoryEntry" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PasswordResetToken" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PaymentChannel" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Policy" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PolicyChecking" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PolicySchedule" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PremiumTransaction" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PrivacyNotice" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfessionalIndemnityPolicy" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfessionalIndemnityRiskEvent" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Prospect" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Quotation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RFQ" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RFQInsurer" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Receipt" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Recommendation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReconciliationException" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RefreshToken" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Refund" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Remittance" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RenewalCase" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RenewalRecommendation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RetentionCase" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RetentionScheduleItem" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RiskProfile" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RiskRating" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RiskRegisterItem" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RopaEntry" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SalesTarget" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScreeningCaseNote" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScreeningHoldRelease" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScreeningMatch" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScreeningRequest" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScreeningResult" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SecurityAwarenessTraining" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SecurityConfig" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ServiceRequest" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Settlement" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SlaHoliday" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SlaPolicy" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SlaPolicyEscalation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SlaTimer" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ThirdPartyClaimant" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TransactionMonitoringAlert" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "TrustedDevice" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UltimateBeneficialOwner" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UpSellRecommendation" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserRoleAssignment" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserSession" ALTER COLUMN "organizationId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Vendor" ALTER COLUMN "organizationId" DROP DEFAULT;
