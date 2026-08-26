-- CreateEnum
CREATE TYPE "DataSharingChannel" AS ENUM ('SECURE_SFTP', 'ENCRYPTED_EMAIL', 'VENDOR_SECURE_PORTAL', 'CBJ_REGULATORY_PORTAL', 'IN_PERSON_ENCRYPTED_MEDIA', 'UNENCRYPTED_EMAIL', 'POSTAL_MAIL', 'OTHER_UNSECURED');

-- AlterTable
ALTER TABLE "DataSharingApproval" ADD COLUMN "classification" "DataClassification" NOT NULL,
ADD COLUMN "channel" "DataSharingChannel" NOT NULL;

-- CreateIndex
CREATE INDEX "DataSharingApproval_classification_idx" ON "DataSharingApproval"("classification");
