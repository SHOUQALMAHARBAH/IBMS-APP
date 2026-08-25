-- AlterTable
ALTER TABLE "TransactionMonitoringAlert" ADD COLUMN     "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_CONFIDENTIAL';

-- AddForeignKey
ALTER TABLE "TransactionMonitoringAlert" ADD CONSTRAINT "TransactionMonitoringAlert_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
