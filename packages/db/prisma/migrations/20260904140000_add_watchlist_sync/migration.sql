-- Process 49 (backlog Part C #49, Domain F — Sanctions & PEP Screening).
-- Adds a local cache of two free, publicly published sanctions/PEP lists
-- (OFAC SDN, UN Consolidated) that ScreeningService matches customer/UBO
-- names against, refreshed by WatchlistSyncScheduler every 12 hours (the
-- lists' own real-world refresh cadence).

-- CreateEnum
CREATE TYPE "WatchlistSource" AS ENUM ('OFAC_SDN', 'UN_CONSOLIDATED');

-- CreateTable
-- classification: a @code-reviewer BLOCKER on the first pass shipped this
-- table with no classification column at all, reasoning in a code comment
-- (not a PRIV-STD-02 citation) that the data was "public, not IBMS customer
-- data". Defaulted to the conservative HIGHLY_CONFIDENTIAL tier pending
-- that citation — remarks can carry a real, named individual's DOB and
-- alleged-conduct text.
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL,
    "source" "WatchlistSource" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "listProgram" TEXT,
    "remarks" TEXT,
    "classification" "DataClassification" NOT NULL DEFAULT 'HIGHLY_CONFIDENTIAL',
    "syncRunId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistSyncRun" (
    "id" TEXT NOT NULL,
    "source" "WatchlistSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "recordCount" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "WatchlistSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_source_sourceRecordId_key" ON "WatchlistEntry"("source", "sourceRecordId");

-- CreateIndex
CREATE INDEX "WatchlistEntry_normalizedName_idx" ON "WatchlistEntry"("normalizedName");

-- CreateIndex
CREATE INDEX "WatchlistEntry_source_idx" ON "WatchlistEntry"("source");

-- RACE-SAFE INVARIANT (ibms-brain/meta/lex/race-safe-invariants.md): at most
-- one 'running' WatchlistSyncRun per source. A @code-reviewer BLOCKER on the
-- first pass: with no guard, a manual POST /watchlist-sync/run firing while
-- the 12-hourly WatchlistSyncScheduler is mid-run (or two concurrent manual
-- triggers) let two syncs of the SAME source interleave — one run's
-- pruneStale deletes rows the OTHER run had just correctly (re-)written
-- under a different syncRunId, silently dropping real, currently-sanctioned
-- entries from the cache until the next sync. A partial UNIQUE,
-- hand-authored because Prisma cannot express the WHERE predicate.
CREATE UNIQUE INDEX "WatchlistSyncRun_one_running_per_source"
  ON "WatchlistSyncRun"("source")
  WHERE "status" = 'running';
