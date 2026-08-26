-- CreateEnum
CREATE TYPE "AccessAnomalyPatternType" AS ENUM ('BULK_EXPORT', 'OFF_HOURS_ACCESS', 'REPEATED_UNJUSTIFIED_ACCESS');

-- CreateTable
CREATE TABLE "AccessAnomalyAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternType" "AccessAnomalyPatternType" NOT NULL,
    "detailText" TEXT,
    "relatedAuditLogEntryIds" TEXT[],
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "classification" "DataClassification" NOT NULL DEFAULT 'CONFIDENTIAL',

    CONSTRAINT "AccessAnomalyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessAnomalyAlert_userId_idx" ON "AccessAnomalyAlert"("userId");

-- CreateIndex
CREATE INDEX "AccessAnomalyAlert_patternType_idx" ON "AccessAnomalyAlert"("patternType");

-- CreateIndex
CREATE INDEX "AccessAnomalyAlert_detectedAt_idx" ON "AccessAnomalyAlert"("detectedAt");

-- AddForeignKey
ALTER TABLE "AccessAnomalyAlert" ADD CONSTRAINT "AccessAnomalyAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
