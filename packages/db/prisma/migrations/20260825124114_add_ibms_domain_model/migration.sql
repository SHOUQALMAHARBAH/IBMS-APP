/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'HIGHLY_CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "LanguagePreference" AS ENUM ('AR', 'EN');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SALES_RELATIONSHIP_OFFICER', 'PLACEMENT_TECHNICAL_OFFICER', 'POLICY_CHECKING_OFFICER', 'CLAIMS_OFFICER', 'FINANCE_COLLECTIONS_OFFICER', 'COMPLIANCE_OFFICER', 'BRANCH_DEPARTMENT_MANAGER', 'DATA_PROTECTION_OFFICER', 'SYSTEM_SECURITY_ADMINISTRATOR', 'EXECUTIVE_MANAGEMENT', 'EXTERNAL_AUDITOR');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'READ', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'TRANSITION', 'EXPORT', 'PRINT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED_TO_PROSPECT', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('MEETING', 'CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'PROPOSAL', 'RENEWAL', 'CLAIM', 'COMPLAINT', 'PORTAL', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEEDS_CONFIRMED', 'RFQ_ISSUED', 'QUOTES_RECEIVED', 'COMPARISON_BUILT', 'RECOMMENDATION_DRAFTED', 'SENT_TO_CLIENT', 'CLIENT_DECISION', 'PLACEMENT', 'RENEGOTIATE', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "RfqInsurerStatus" AS ENUM ('SENT', 'VIEWED', 'QUOTED', 'DECLINED', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "ClientDecisionType" AS ENUM ('ACCEPT', 'REJECT', 'REQUEST_FURTHER_NEGOTIATION', 'REQUEST_ALTERNATIVE_OPTIONS', 'REQUEST_PRICE_REDUCTION', 'REQUEST_COVERAGE_INCREASE');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('PLACEMENT_CONFIRMED', 'ISSUED', 'CHECKING_IN_PROGRESS', 'DISCREPANCY', 'VERIFIED', 'DELIVERED', 'ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EndorsementType" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "EndorsementStatus" AS ENUM ('REQUESTED', 'SUBMITTED_TO_INSURER', 'INSURER_CONFIRMED', 'FINANCIAL_ADJUSTMENT_CALCULATED', 'REFUND_APPROVAL_PENDING', 'APPLIED', 'CLIENT_NOTIFIED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('NOTIFIED', 'REGISTERED', 'DOCUMENTATION_IN_PROGRESS', 'UNDER_ASSESSMENT', 'APPROVED', 'PARTIALLY_APPROVED', 'DECLINED', 'SETTLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('INVOICED', 'COLLECTED', 'RECONCILED', 'REMITTED', 'EXCEPTION_RAISED', 'EXCEPTION_RESOLVED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('LOGGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('RENEWAL_DUE', 'IN_PROGRESS', 'QUOTES_OBTAINED', 'RECOMMENDED', 'CLIENT_DECISION', 'RENEWED', 'LAPSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('REPORTED', 'CONTAINED', 'IMPACT_ASSESSED', 'CLASSIFIED', 'NOTIFIED', 'RECOVERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IncidentClassification" AS ENUM ('NOT_YET_CLASSIFIED', 'MATERIAL', 'NON_MATERIAL');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('UNDERWRITING', 'CLAIMS', 'MARKETING', 'KYC_AML', 'SHARING_WITH_INSURER', 'OTHER');

-- CreateEnum
CREATE TYPE "DsrType" AS ENUM ('ACCESS', 'CORRECTION', 'DELETION', 'OBJECTION');

-- CreateEnum
CREATE TYPE "DsrStatus" AS ENUM ('RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisposalBatchStatus" AS ENUM ('NOMINATED', 'MANAGER_APPROVED', 'DPO_APPROVED', 'EXECUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DpiaOutcome" AS ENUM ('AUTO_APPROVED', 'DPO_REVIEW_REQUIRED', 'ESCALATED_FULL_DPIA');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('APPLICATION_PROPOSAL', 'RISK_SURVEY', 'QUOTATION', 'COMPARISON', 'RECOMMENDATION', 'CLIENT_APPROVAL', 'POLICY', 'ENDORSEMENT', 'INVOICE', 'RECEIPT', 'CLAIM', 'CORRESPONDENCE', 'OTHER');

-- DropTable
DROP TABLE "HealthCheck";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "languagePreference" "LanguagePreference" NOT NULL DEFAULT 'AR',
    "branchId" TEXT,
    "employeeId" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "accessValidFrom" TIMESTAMP(3),
    "accessValidUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRecertificationCycle" (
    "id" TEXT NOT NULL,
    "cycleLabel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AccessRecertificationCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRecertificationItem" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRecertificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "position" TEXT,
    "hireDate" TIMESTAMP(3),
    "terminationDate" TIMESTAMP(3),
    "licensedRole" TEXT,
    "confidentialityAgreementSignedAt" TIMESTAMP(3),
    "backgroundCheckCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAwarenessTraining" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingName" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "SecurityAwarenessTraining_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDeprovisioningChecklist" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systemAccessRevokedAt" TIMESTAMP(3),
    "physicalAccessRevokedAt" TIMESTAMP(3),
    "deviceReturnedAt" TIMESTAMP(3),
    "knowledgeTransferDoneAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AccessDeprovisioningChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "marketingConsentGranted" BOOLEAN NOT NULL DEFAULT false,
    "firstContactAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "companyName" TEXT NOT NULL,
    "sector" TEXT,
    "activity" TEXT,
    "employeeCount" INTEGER,
    "businessSize" TEXT,
    "location" TEXT,
    "contactPerson" TEXT,
    "productsOfInterest" TEXT[],
    "expectedPremium" DECIMAL(18,3),
    "salesOwnerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'qualifying',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT,
    "customerType" "CustomerType" NOT NULL,
    "legalName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "nationalIdEnc" TEXT,
    "taxRegistrationNumber" TEXT,
    "registeredAddress" TEXT,
    "natureOfBusiness" TEXT,
    "contactPhoneEnc" TEXT,
    "contactEmailEnc" TEXT,
    "languagePreference" "LanguagePreference" NOT NULL DEFAULT 'AR',
    "status" "CustomerStatus" NOT NULL DEFAULT 'PENDING_KYC',
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UltimateBeneficialOwner" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT NOT NULL,
    "ownershipPercent" DECIMAL(5,2),
    "isAuthorizedSignatory" BOOLEAN NOT NULL DEFAULT false,
    "isPep" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UltimateBeneficialOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuredPerson" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "policyId" TEXT,
    "role" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdEnc" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuredPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KYCRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isEdd" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "nextReviewDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KYCRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResult" (
    "id" TEXT NOT NULL,
    "kycRecordId" TEXT NOT NULL,
    "screeningType" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "screenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listSource" TEXT,
    "escalatedToComplianceAt" TIMESTAMP(3),

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskRating" (
    "id" TEXT NOT NULL,
    "kycRecordId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "InteractionChannel" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossSellOpportunity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "gapLine" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "CrossSellOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpSellRecommendation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currentSumInsured" DECIMAL(18,3) NOT NULL,
    "currentAssetValue" DECIMAL(18,3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "UpSellRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteLabel" TEXT,
    "priorClaimsHistorySummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "riskProfileId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "description" TEXT,
    "declaredValue" DECIMAL(18,3),
    "annualGrossProfit" DECIMAL(18,3),
    "indemnityPeriodMonths" INTEGER,
    "fleetVehicleCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NeedsAssessment" (
    "id" TEXT NOT NULL,
    "riskProfileId" TEXT NOT NULL,
    "questionnaireAnswers" JSONB NOT NULL,
    "recommendedCoverageLines" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NeedsAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceProgram" (
    "id" TEXT NOT NULL,
    "riskProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceProgramLine" (
    "id" TEXT NOT NULL,
    "insuranceProgramId" TEXT NOT NULL,
    "insuranceLine" TEXT NOT NULL,
    "sumInsuredBasis" DECIMAL(18,3),

    CONSTRAINT "InsuranceProgramLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "insuranceProgramId" TEXT,
    "isRenewal" BOOLEAN NOT NULL DEFAULT false,
    "renewalCaseId" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEEDS_CONFIRMED',
    "targetPremiumThreshold" DECIMAL(18,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "insuranceLine" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpThresholdDays" INTEGER NOT NULL DEFAULT 9,

    CONSTRAINT "RFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQInsurer" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "status" "RfqInsurerStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "followUpAlertSentAt" TIMESTAMP(3),

    CONSTRAINT "RFQInsurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "isCurrentVersion" BOOLEAN NOT NULL DEFAULT true,
    "premium" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "deductible" DECIMAL(18,3),
    "limits" JSONB,
    "biPeriodMonths" INTEGER,
    "liabilityLimit" DECIMAL(18,3),
    "exclusions" TEXT,
    "conditions" TEXT,
    "commissionRatePercent" DECIMAL(5,2),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonMatrix" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingInsurers" TEXT[],

    CONSTRAINT "ComparisonMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonMatrixRow" (
    "id" TEXT NOT NULL,
    "comparisonMatrixId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "insurerQualityScore" DECIMAL(5,2),
    "serviceScore" DECIMAL(5,2),

    CONSTRAINT "ComparisonMatrixRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "recommendedQuotationId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "draftedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentToClientAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictOfInterestDisclosure" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "competingQuotationId" TEXT,
    "commissionDifferencePercent" DECIMAL(5,2),
    "disclosureText" TEXT NOT NULL,
    "acknowledgedByUserId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictOfInterestDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDecision" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "decision" "ClientDecisionType" NOT NULL,
    "evidenceType" TEXT,
    "evidenceRef" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "policyNumber" TEXT,
    "insuranceLine" TEXT NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'PLACEMENT_CONFIRMED',
    "inceptionDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "requestedPremium" DECIMAL(18,3) NOT NULL,
    "issuedPremium" DECIMAL(18,3),
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySchedule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "limits" JSONB NOT NULL,
    "sumsInsured" JSONB NOT NULL,
    "namedPerils" TEXT[],
    "extensions" TEXT[],
    "sourceEndorsementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverNote" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyChecking" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "placedByUserId" TEXT NOT NULL,
    "checkedByUserId" TEXT,
    "checklistResult" JSONB,
    "discrepancyFound" BOOLEAN NOT NULL DEFAULT false,
    "discrepancyDetail" TEXT,
    "discrepancyLoggedAsPiRiskEvent" BOOLEAN NOT NULL DEFAULT false,
    "complianceOverrideByUserId" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyChecking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRecord" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "receiptAcknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endorsement" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "type" "EndorsementType" NOT NULL,
    "changeType" TEXT NOT NULL,
    "status" "EndorsementStatus" NOT NULL DEFAULT 'REQUESTED',
    "premiumAdjustment" DECIMAL(18,3) NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "insurerConfirmedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "clientNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Endorsement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cancellation" (
    "id" TEXT NOT NULL,
    "endorsementId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "returnPremium" DECIMAL(18,3) NOT NULL,
    "clientNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "endorsementId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvalThresholdMatrixLevel" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionReversal" (
    "id" TEXT NOT NULL,
    "endorsementId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "claimNumber" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'NOTIFIED',
    "lossDate" TIMESTAMP(3) NOT NULL,
    "lossLocation" TEXT,
    "causeOfLoss" TEXT,
    "estimatedLoss" DECIMAL(18,3) NOT NULL,
    "isThirdPartyInvolved" BOOLEAN NOT NULL DEFAULT false,
    "isLargeClaim" BOOLEAN NOT NULL DEFAULT false,
    "insurerClaimReference" TEXT,
    "followUpAlertThresholdDays" INTEGER NOT NULL DEFAULT 9,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_CONFIDENTIAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimDocument" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,

    CONSTRAINT "ClaimDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimStatusHistory" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "estimatedLoss" DECIMAL(18,3) NOT NULL,
    "approvedAmount" DECIMAL(18,3),
    "deductible" DECIMAL(18,3),
    "netSettlement" DECIMAL(18,3),
    "approvedByUserId" TEXT,
    "secondApproverUserId" TEXT,
    "clientPaymentConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdPartyClaimant" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fullName" TEXT,
    "contactDetailsEnc" TEXT,
    "subrogationRecoveryFlag" BOOLEAN NOT NULL DEFAULT false,
    "recoveryAmount" DECIMAL(18,3),

    CONSTRAINT "ThirdPartyClaimant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adjuster" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firm" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surveyCompletedAt" TIMESTAMP(3),
    "investigationCompletedAt" TIMESTAMP(3),

    CONSTRAINT "Adjuster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimFollowUpAlert" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ClaimFollowUpAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumTransaction" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "relatedEndorsementId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "customerId" TEXT NOT NULL,
    "premiumAmount" DECIMAL(18,3) NOT NULL,
    "taxAmount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "feesAmount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "commissionDeducted" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'INVOICED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Remittance" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "remittedAt" TIMESTAMP(3),

    CONSTRAINT "Remittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAgreement" (
    "id" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "insuranceLine" TEXT NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "CommissionAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLedgerEntry" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "commissionAgreementId" TEXT,
    "amount" DECIMAL(18,3) NOT NULL,
    "vatAmount" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideApprovedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationException" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "insurerStatementAmount" DECIMAL(18,3) NOT NULL,
    "brokerRecordAmount" DECIMAL(18,3) NOT NULL,
    "varianceAmount" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "investigatedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFundsLedgerEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "direction" TEXT NOT NULL,
    "reference" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientFundsLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "slaTimerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "claimId" TEXT,
    "policyId" TEXT,
    "issue" TEXT NOT NULL,
    "category" TEXT,
    "responsibleEmployeeUserId" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'LOGGED',
    "slaTimerId" TEXT,
    "resolution" TEXT,
    "closureApprovedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintAction" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "actionText" TEXT NOT NULL,
    "takenByUserId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRecord" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "escalatedTo" TEXT NOT NULL,
    "escalatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "EscalationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationLog" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "InteractionChannel" NOT NULL,
    "templateId" TEXT,
    "languageUsed" "LanguagePreference" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respectedConsent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "score" INTEGER,
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionCase" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "RetentionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalCase" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "status" "RenewalStatus" NOT NULL DEFAULT 'RENEWAL_DUE',
    "leadTimeDays" INTEGER NOT NULL DEFAULT 90,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "riskChangedSinceLastRenewal" BOOLEAN NOT NULL DEFAULT false,
    "insurerTermsWorsened" BOOLEAN NOT NULL DEFAULT false,
    "retentionEscalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossRatio" (
    "id" TEXT NOT NULL,
    "renewalCaseId" TEXT NOT NULL,
    "periodClaims" DECIMAL(18,3) NOT NULL,
    "periodPremium" DECIMAL(18,3) NOT NULL,
    "ratio" DECIMAL(7,4) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossRatio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalRecommendation" (
    "id" TEXT NOT NULL,
    "renewalCaseId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerLicense" (
    "id" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "scopeOfAuthorization" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "BrokerLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalIndemnityPolicy" (
    "id" TEXT NOT NULL,
    "insurerName" TEXT NOT NULL,
    "coverageLimit" DECIMAL(18,3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimsHistorySummary" TEXT,

    CONSTRAINT "ProfessionalIndemnityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalIndemnityRiskEvent" (
    "id" TEXT NOT NULL,
    "piPolicyId" TEXT,
    "sourcePolicyCheckingId" TEXT,
    "description" TEXT NOT NULL,
    "mitigationAction" TEXT,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalIndemnityRiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceCalendarItem" (
    "id" TEXT NOT NULL,
    "obligationName" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "evidenceOfSubmissionRef" TEXT,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ComplianceCalendarItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalRiskRegisterItem" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mitigationAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalRiskRegisterItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalAuditFinding" (
    "id" TEXT NOT NULL,
    "auditPeriodLabel" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "remediationAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "InternalAuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'REPORTED',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "containedAt" TIMESTAMP(3),
    "impactAssessedAt" TIMESTAMP(3),
    "classification" "IncidentClassification" NOT NULL DEFAULT 'NOT_YET_CLASSIFIED',
    "classifiedByDpoUserId" TEXT,
    "seniorManagementCoSignUserId" TEXT,
    "seniorManagementNotifiedAt" TIMESTAMP(3),
    "notifiedRegulators" TEXT[],
    "notifiedAt" TIMESTAMP(3),
    "affectedDataSubjectsNotifiedAt" TIMESTAMP(3),
    "rootCauseAnalysis" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "insuredPersonId" TEXT,
    "purpose" "ConsentPurpose" NOT NULL,
    "isMarketing" BOOLEAN NOT NULL DEFAULT false,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "consentTextVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "insuredPersonId" TEXT,
    "type" "DsrType" NOT NULL,
    "status" "DsrStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identityVerifiedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "accessExtensionAppliedAt" TIMESTAMP(3),
    "extensionReason" TEXT,
    "retentionScheduleReference" TEXT,
    "partialFulfilmentJustification" TEXT,
    "closedAt" TIMESTAMP(3),
    "dpoHandlerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionScheduleItem" (
    "id" TEXT NOT NULL,
    "recordCategory" TEXT NOT NULL,
    "retentionPeriodMonths" INTEGER NOT NULL,
    "legalBasis" TEXT,
    "confirmedByLegalCounselAt" TIMESTAMP(3),

    CONSTRAINT "RetentionScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextReviewDueAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisposalBatch" (
    "id" TEXT NOT NULL,
    "retentionScheduleItemId" TEXT,
    "status" "DisposalBatchStatus" NOT NULL DEFAULT 'NOMINATED',
    "nominatedByUserId" TEXT NOT NULL,
    "managerApprovedAt" TIMESTAMP(3),
    "dpoApprovedByUserId" TEXT,
    "dpoApprovedAt" TIMESTAMP(3),
    "method" TEXT,
    "executedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisposalBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateOfDestruction" (
    "id" TEXT NOT NULL,
    "disposalBatchId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" TEXT NOT NULL,

    CONSTRAINT "CertificateOfDestruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossBorderTransferRecord" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "legalBasisEvidenceRef" TEXT,
    "approvedByUserId" TEXT,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossBorderTransferRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendorType" TEXT NOT NULL,
    "riskTier" TEXT,
    "annualReviewDueAt" TIMESTAMP(3),
    "terminationDataReturnConfirmedAt" TIMESTAMP(3),
    "accessRevokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataProcessingAgreement" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "dpoApprovedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "DataProcessingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSharingApproval" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "description" TEXT NOT NULL,
    "isRegulatoryChannel" BOOLEAN NOT NULL DEFAULT false,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSharingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DpiaScreening" (
    "id" TEXT NOT NULL,
    "subjectDescription" TEXT NOT NULL,
    "qSensitiveData" BOOLEAN NOT NULL,
    "qLargeScaleProcessing" BOOLEAN NOT NULL,
    "qCrossBorderTransfer" BOOLEAN NOT NULL,
    "qNewTechnologyMonitoring" BOOLEAN NOT NULL,
    "qNewDigitalChannel" BOOLEAN NOT NULL,
    "outcome" "DpiaOutcome" NOT NULL,
    "dpoReviewDueAt" TIMESTAMP(3),
    "dpoReviewedAt" TIMESTAMP(3),
    "dpoSpotCheckedAt" TIMESTAMP(3),
    "escalatedToFullDpiaAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DpiaScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyNotice" (
    "id" TEXT NOT NULL,
    "touchpoint" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "textAr" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "legallyReviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RopaEntry" (
    "id" TEXT NOT NULL,
    "processingActivity" TEXT NOT NULL,
    "categoriesOfData" TEXT[],
    "purpose" TEXT NOT NULL,
    "recipients" TEXT[],
    "retentionPeriodMonths" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RopaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurerPerformanceScore" (
    "id" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "quoteResponseScore" DECIMAL(5,2) NOT NULL,
    "claimsServiceScore" DECIMAL(5,2) NOT NULL,
    "priceScore" DECIMAL(5,2) NOT NULL,
    "serviceQualityScore" DECIMAL(5,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurerPerformanceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePerformanceRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "newClients" INTEGER,
    "premiumWritten" DECIMAL(18,3),
    "commissionEarned" DECIMAL(18,3),
    "renewalRatePercent" DECIMAL(5,2),
    "crossSellRatePercent" DECIMAL(5,2),

    CONSTRAINT "EmployeePerformanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BcpDrPlan" (
    "id" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "planDocumentId" TEXT,
    "rtoHours" INTEGER,
    "rpoHours" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "nextTestDueAt" TIMESTAMP(3),

    CONSTRAINT "BcpDrPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBaseArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleAr" TEXT,
    "category" TEXT NOT NULL,
    "bodyEn" TEXT,
    "bodyAr" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeBaseArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insurer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "claimsContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Insurer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "policyId" TEXT,
    "category" "DocumentCategory" NOT NULL,
    "classification" "DataClassification" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "deletionLocked" BOOLEAN NOT NULL DEFAULT true,
    "deletionOverrideByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "isSensitiveDataAccess" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaTimer" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "workflowName" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "escalatedTo" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaTimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_key" ON "UserRoleAssignment"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessDeprovisioningChecklist_employeeId_key" ON "AccessDeprovisioningChecklist"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_leadId_key" ON "Prospect"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_prospectId_key" ON "Customer"("prospectId");

-- CreateIndex
CREATE INDEX "Customer_legalName_idx" ON "Customer"("legalName");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "KYCRecord_customerId_idx" ON "KYCRecord"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRating_kycRecordId_key" ON "RiskRating"("kycRecordId");

-- CreateIndex
CREATE INDEX "Interaction_customerId_idx" ON "Interaction"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_renewalCaseId_key" ON "Opportunity"("renewalCaseId");

-- CreateIndex
CREATE INDEX "Opportunity_customerId_idx" ON "Opportunity"("customerId");

-- CreateIndex
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RFQInsurer_rfqId_insurerId_key" ON "RFQInsurer"("rfqId", "insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_previousVersionId_key" ON "Quotation"("previousVersionId");

-- CreateIndex
CREATE INDEX "Quotation_rfqId_idx" ON "Quotation"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonMatrix_rfqId_key" ON "ComparisonMatrix"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_opportunityId_key" ON "Recommendation"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_recommendedQuotationId_key" ON "Recommendation"("recommendedQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictOfInterestDisclosure_recommendationId_key" ON "ConflictOfInterestDisclosure"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDecision_opportunityId_key" ON "ClientDecision"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_opportunityId_key" ON "Policy"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_policyNumber_key" ON "Policy"("policyNumber");

-- CreateIndex
CREATE INDEX "Policy_customerId_idx" ON "Policy"("customerId");

-- CreateIndex
CREATE INDEX "Policy_status_idx" ON "Policy"("status");

-- CreateIndex
CREATE INDEX "Policy_expiryDate_idx" ON "Policy"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "PolicySchedule_sourceEndorsementId_key" ON "PolicySchedule"("sourceEndorsementId");

-- CreateIndex
CREATE INDEX "PolicySchedule_policyId_effectiveFrom_idx" ON "PolicySchedule"("policyId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CoverNote_policyId_key" ON "CoverNote"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyChecking_policyId_key" ON "PolicyChecking"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRecord_policyId_key" ON "DeliveryRecord"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "Cancellation_endorsementId_key" ON "Cancellation"("endorsementId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_endorsementId_key" ON "Refund"("endorsementId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionReversal_endorsementId_key" ON "CommissionReversal"("endorsementId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_claimNumber_key" ON "Claim"("claimNumber");

-- CreateIndex
CREATE INDEX "Claim_policyId_idx" ON "Claim"("policyId");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "Claim_lossDate_idx" ON "Claim"("lossDate");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_claimId_key" ON "Settlement"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ThirdPartyClaimant_claimId_key" ON "ThirdPartyClaimant"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Adjuster_claimId_key" ON "Adjuster"("claimId");

-- CreateIndex
CREATE INDEX "PremiumTransaction_policyId_idx" ON "PremiumTransaction"("policyId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Remittance_receiptId_key" ON "Remittance"("receiptId");

-- CreateIndex
CREATE INDEX "CommissionAgreement_insurerId_insuranceLine_idx" ON "CommissionAgreement"("insurerId", "insuranceLine");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_slaTimerId_key" ON "ServiceRequest"("slaTimerId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_slaTimerId_key" ON "Complaint"("slaTimerId");

-- CreateIndex
CREATE INDEX "Complaint_customerId_idx" ON "Complaint"("customerId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalCase_policyId_key" ON "RenewalCase"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "LossRatio_renewalCaseId_key" ON "LossRatio"("renewalCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalRecommendation_renewalCaseId_key" ON "RenewalRecommendation"("renewalCaseId");

-- CreateIndex
CREATE INDEX "ConsentRecord_customerId_idx" ON "ConsentRecord"("customerId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_idx" ON "DataSubjectRequest"("status");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_slaDueAt_idx" ON "DataSubjectRequest"("slaDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateOfDestruction_disposalBatchId_key" ON "CertificateOfDestruction"("disposalBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_previousVersionId_key" ON "Document"("previousVersionId");

-- CreateIndex
CREATE INDEX "Document_policyId_idx" ON "Document"("policyId");

-- CreateIndex
CREATE INDEX "Document_classification_idx" ON "Document"("classification");

-- CreateIndex
CREATE INDEX "AuditLogEntry_entityType_entityId_idx" ON "AuditLogEntry"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_userId_idx" ON "AuditLogEntry"("userId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_occurredAt_idx" ON "AuditLogEntry"("occurredAt");

-- CreateIndex
CREATE INDEX "SlaTimer_entityType_entityId_idx" ON "SlaTimer"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "SlaTimer_dueAt_idx" ON "SlaTimer"("dueAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignment" ADD CONSTRAINT "UserRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecertificationItem" ADD CONSTRAINT "AccessRecertificationItem_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AccessRecertificationCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRecertificationItem" ADD CONSTRAINT "AccessRecertificationItem_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAwarenessTraining" ADD CONSTRAINT "SecurityAwarenessTraining_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDeprovisioningChecklist" ADD CONSTRAINT "AccessDeprovisioningChecklist_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UltimateBeneficialOwner" ADD CONSTRAINT "UltimateBeneficialOwner_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredPerson" ADD CONSTRAINT "InsuredPerson_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuredPerson" ADD CONSTRAINT "InsuredPerson_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KYCRecord" ADD CONSTRAINT "KYCRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_kycRecordId_fkey" FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRating" ADD CONSTRAINT "RiskRating_kycRecordId_fkey" FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossSellOpportunity" ADD CONSTRAINT "CrossSellOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpSellRecommendation" ADD CONSTRAINT "UpSellRecommendation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskProfile" ADD CONSTRAINT "RiskProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_riskProfileId_fkey" FOREIGN KEY ("riskProfileId") REFERENCES "RiskProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedsAssessment" ADD CONSTRAINT "NeedsAssessment_riskProfileId_fkey" FOREIGN KEY ("riskProfileId") REFERENCES "RiskProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceProgram" ADD CONSTRAINT "InsuranceProgram_riskProfileId_fkey" FOREIGN KEY ("riskProfileId") REFERENCES "RiskProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceProgramLine" ADD CONSTRAINT "InsuranceProgramLine_insuranceProgramId_fkey" FOREIGN KEY ("insuranceProgramId") REFERENCES "InsuranceProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_insuranceProgramId_fkey" FOREIGN KEY ("insuranceProgramId") REFERENCES "InsuranceProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_renewalCaseId_fkey" FOREIGN KEY ("renewalCaseId") REFERENCES "RenewalCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQInsurer" ADD CONSTRAINT "RFQInsurer_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQInsurer" ADD CONSTRAINT "RFQInsurer_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonMatrix" ADD CONSTRAINT "ComparisonMatrix_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonMatrixRow" ADD CONSTRAINT "ComparisonMatrixRow_comparisonMatrixId_fkey" FOREIGN KEY ("comparisonMatrixId") REFERENCES "ComparisonMatrix"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonMatrixRow" ADD CONSTRAINT "ComparisonMatrixRow_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_recommendedQuotationId_fkey" FOREIGN KEY ("recommendedQuotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterestDisclosure" ADD CONSTRAINT "ConflictOfInterestDisclosure_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDecision" ADD CONSTRAINT "ClientDecision_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySchedule" ADD CONSTRAINT "PolicySchedule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySchedule" ADD CONSTRAINT "PolicySchedule_sourceEndorsementId_fkey" FOREIGN KEY ("sourceEndorsementId") REFERENCES "Endorsement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverNote" ADD CONSTRAINT "CoverNote_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyChecking" ADD CONSTRAINT "PolicyChecking_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRecord" ADD CONSTRAINT "DeliveryRecord_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancellation" ADD CONSTRAINT "Cancellation_endorsementId_fkey" FOREIGN KEY ("endorsementId") REFERENCES "Endorsement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_endorsementId_fkey" FOREIGN KEY ("endorsementId") REFERENCES "Endorsement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionReversal" ADD CONSTRAINT "CommissionReversal_endorsementId_fkey" FOREIGN KEY ("endorsementId") REFERENCES "Endorsement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDocument" ADD CONSTRAINT "ClaimDocument_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimDocument" ADD CONSTRAINT "ClaimDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimStatusHistory" ADD CONSTRAINT "ClaimStatusHistory_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThirdPartyClaimant" ADD CONSTRAINT "ThirdPartyClaimant_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Adjuster" ADD CONSTRAINT "Adjuster_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimFollowUpAlert" ADD CONSTRAINT "ClaimFollowUpAlert_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumTransaction" ADD CONSTRAINT "PremiumTransaction_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Remittance" ADD CONSTRAINT "Remittance_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAgreement" ADD CONSTRAINT "CommissionAgreement_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerEntry" ADD CONSTRAINT "CommissionLedgerEntry_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedgerEntry" ADD CONSTRAINT "CommissionLedgerEntry_commissionAgreementId_fkey" FOREIGN KEY ("commissionAgreementId") REFERENCES "CommissionAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationException" ADD CONSTRAINT "ReconciliationException_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFundsLedgerEntry" ADD CONSTRAINT "ClientFundsLedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_slaTimerId_fkey" FOREIGN KEY ("slaTimerId") REFERENCES "SlaTimer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_slaTimerId_fkey" FOREIGN KEY ("slaTimerId") REFERENCES "SlaTimer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintAction" ADD CONSTRAINT "ComplaintAction_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRecord" ADD CONSTRAINT "EscalationRecord_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedback" ADD CONSTRAINT "CustomerFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionCase" ADD CONSTRAINT "RetentionCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalCase" ADD CONSTRAINT "RenewalCase_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRatio" ADD CONSTRAINT "LossRatio_renewalCaseId_fkey" FOREIGN KEY ("renewalCaseId") REFERENCES "RenewalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalRecommendation" ADD CONSTRAINT "RenewalRecommendation_renewalCaseId_fkey" FOREIGN KEY ("renewalCaseId") REFERENCES "RenewalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalIndemnityRiskEvent" ADD CONSTRAINT "ProfessionalIndemnityRiskEvent_piPolicyId_fkey" FOREIGN KEY ("piPolicyId") REFERENCES "ProfessionalIndemnityPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_insuredPersonId_fkey" FOREIGN KEY ("insuredPersonId") REFERENCES "InsuredPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_insuredPersonId_fkey" FOREIGN KEY ("insuredPersonId") REFERENCES "InsuredPerson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisposalBatch" ADD CONSTRAINT "DisposalBatch_retentionScheduleItemId_fkey" FOREIGN KEY ("retentionScheduleItemId") REFERENCES "RetentionScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateOfDestruction" ADD CONSTRAINT "CertificateOfDestruction_disposalBatchId_fkey" FOREIGN KEY ("disposalBatchId") REFERENCES "DisposalBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataProcessingAgreement" ADD CONSTRAINT "DataProcessingAgreement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSharingApproval" ADD CONSTRAINT "DataSharingApproval_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurerPerformanceScore" ADD CONSTRAINT "InsurerPerformanceScore_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePerformanceRecord" ADD CONSTRAINT "EmployeePerformanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
