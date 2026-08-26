-- AlterTable
ALTER TABLE "CommissionLedgerEntry" ADD COLUMN     "overrideRequestedByUserId" TEXT;

-- AlterTable
ALTER TABLE "DataProcessingAgreement" ADD COLUMN     "assessedByUserId" TEXT;
