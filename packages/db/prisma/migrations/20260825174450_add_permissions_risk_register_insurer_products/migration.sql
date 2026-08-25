-- AlterTable
ALTER TABLE "public"."Insurer" ADD COLUMN     "creditTermsDays" INTEGER,
ADD COLUMN     "financialStrengthRating" TEXT,
ADD COLUMN     "underwriterContact" TEXT;

-- DropTable
DROP TABLE "public"."OperationalRiskRegisterItem";

-- CreateTable
CREATE TABLE "public"."InformationAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "classification" "public"."DataClassification" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InformationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InsurerProduct" (
    "id" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "insuranceLine" TEXT NOT NULL,
    "productName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InsurerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InsurerSlaAgreement" (
    "id" TEXT NOT NULL,
    "insurerId" TEXT NOT NULL,
    "slaType" TEXT NOT NULL,
    "targetDays" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurerSlaAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RiskRegisterItem" (
    "id" TEXT NOT NULL,
    "riskType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mitigationAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "RiskRegisterItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TransactionMonitoringAlert" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "patternType" TEXT NOT NULL,
    "detailText" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "escalatedToSuspiciousActivity" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" TIMESTAMP(3),
    "reportedToAuthorityAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "TransactionMonitoringAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "public"."Permission"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "public"."RolePermission"("roleId" ASC, "permissionId" ASC);

-- AddForeignKey
ALTER TABLE "public"."InsurerProduct" ADD CONSTRAINT "InsurerProduct_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InsurerSlaAgreement" ADD CONSTRAINT "InsurerSlaAgreement_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."Insurer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

