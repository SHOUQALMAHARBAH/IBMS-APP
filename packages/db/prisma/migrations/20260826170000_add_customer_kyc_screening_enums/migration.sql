-- Part C backlog #3-4 (Customer Acquisition / Onboarding). Converts
-- KYCRecord.status, ScreeningResult.screeningType/.result, and
-- RiskRating.level from free-text String columns to proper enums (the
-- KYCRecord.status values transcribe the model's own pre-existing comment
-- verbatim) so KYCRecord can plug into WorkflowTransitionService (A.6) the
-- same way LeadStatus did. Also adds Document.customerId so
-- APPLICATION_PROPOSAL onboarding documents can attach to a Customer before
-- any Policy exists (Document previously only linked to Policy despite
-- meta/context/data-model.md describing it as polymorphic). All four tables
-- are empty in every environment this migration has been applied to (no
-- Customer/KYC module existed before this backlog item), so the
-- DROP COLUMN/ADD COLUMN rewrite below is safe — there is no data to lose.

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SCREENING', 'EDD', 'COMPLIANCE_REVIEW', 'APPROVED', 'REJECTED', 'PERIODIC_REVIEW_DUE');

-- CreateEnum
CREATE TYPE "ScreeningType" AS ENUM ('SANCTIONS', 'PEP', 'AML');

-- CreateEnum
CREATE TYPE "ScreeningOutcome" AS ENUM ('CLEAR', 'HIT', 'PENDING_INVESTIGATION');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('STANDARD', 'HIGH');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "customerId" TEXT;

-- AlterTable
ALTER TABLE "KYCRecord" DROP COLUMN "status",
ADD COLUMN     "status" "KycStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "RiskRating" DROP COLUMN "level",
ADD COLUMN     "level" "RiskLevel" NOT NULL;

-- AlterTable
ALTER TABLE "ScreeningResult" DROP COLUMN "screeningType",
ADD COLUMN     "screeningType" "ScreeningType" NOT NULL,
DROP COLUMN "result",
ADD COLUMN     "result" "ScreeningOutcome" NOT NULL;

-- CreateIndex
CREATE INDEX "Document_customerId_idx" ON "Document"("customerId");

-- CreateIndex
CREATE INDEX "KYCRecord_status_idx" ON "KYCRecord"("status");

-- CreateIndex
CREATE INDEX "ScreeningResult_kycRecordId_idx" ON "ScreeningResult"("kycRecordId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
