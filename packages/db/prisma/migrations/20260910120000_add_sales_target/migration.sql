-- Process 59 (backlog Part C #59, Domain G — Sales Performance). Adds
-- SalesTarget, a quota set for one Sales/Relationship Officer OR one Branch
-- (never both) for a period; SalesPerformanceService resolves the "actual"
-- side live against Lead/Prospect at read time rather than storing it here.

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "branchId" TEXT,
    "periodLabel" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "targetNewProspects" INTEGER NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesTarget_ownerUserId_idx" ON "SalesTarget"("ownerUserId");

-- CreateIndex
CREATE INDEX "SalesTarget_branchId_idx" ON "SalesTarget"("branchId");

-- CreateIndex
CREATE INDEX "SalesTarget_periodStart_periodEnd_idx" ON "SalesTarget"("periodStart", "periodEnd");

-- Exactly one of ownerUserId/branchId — an individual quota XOR a team quota,
-- never both, never neither. Cannot be expressed in schema.prisma (Prisma
-- has no cross-column CHECK syntax), the #55/#56 hand-authored-CHECK shape.
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_owner_xor_branch" CHECK (
    ("ownerUserId" IS NOT NULL AND "branchId" IS NULL)
    OR
    ("ownerUserId" IS NULL AND "branchId" IS NOT NULL)
);

-- "At most one target per owner per period label" and "at most one target
-- per branch per period label", enforced independently. NOT a single
-- composite @@unique([ownerUserId, branchId, periodLabel]) — Postgres
-- treats every NULL as distinct in a plain (non-partial) unique index, so a
-- composite key would silently never collide on the column that's always
-- NULL for that row's scope (the #48 AML gotcha). Two hand-authored PARTIAL
-- unique indexes instead (the UpSellRecommendation/ClaimFollowUpAlert shape).
CREATE UNIQUE INDEX "SalesTarget_owner_period_unique" ON "SalesTarget"("ownerUserId", "periodLabel") WHERE "ownerUserId" IS NOT NULL;

CREATE UNIQUE INDEX "SalesTarget_branch_period_unique" ON "SalesTarget"("branchId", "periodLabel") WHERE "branchId" IS NOT NULL;
