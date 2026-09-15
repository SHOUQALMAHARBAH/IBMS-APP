-- Part B §13/§21: match provenance, and knowing the list moved.
--
-- §13. A reviewer opening a six-month-old match has to know which matching
-- rules and which thresholds produced it. The score was already stored; the
-- line it was compared against was not, so lowering a review threshold made
-- every historical match silently uninterpretable.
ALTER TABLE "ScreeningRequest" ADD COLUMN "algorithmVersion" TEXT;
ALTER TABLE "ScreeningRequest" ADD COLUMN "thresholds" JSONB;

ALTER TABLE "ScreeningMatch" ADD COLUMN "reviewThreshold" DOUBLE PRECISION;
ALTER TABLE "ScreeningMatch" ADD COLUMN "algorithmVersion" TEXT;

-- A score is a number between 0 and 1 or it is nothing. A stored 1.4 would
-- band as "high" against every threshold and never be questioned.
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_matchScore_range"
    CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 1));
ALTER TABLE "ScreeningMatch" ADD CONSTRAINT "ScreeningMatch_reviewThreshold_range"
    CHECK ("reviewThreshold" IS NULL OR ("reviewThreshold" >= 0 AND "reviewThreshold" <= 1));

-- §21. How many entries a sync run saw for the FIRST time. Only additions
-- matter for re-screening: an entry leaving a list cannot create a match that
-- did not exist before, but one arriving can.
ALTER TABLE "WatchlistSyncRun" ADD COLUMN "addedCount" INTEGER;
ALTER TABLE "WatchlistSyncRun" ADD CONSTRAINT "WatchlistSyncRun_addedCount_nonnegative"
    CHECK ("addedCount" IS NULL OR "addedCount" >= 0);

-- Read on every hold evaluation: "the newest succeeded run that added
-- anything". Without the index that is a scan of every sync run ever.
CREATE INDEX "WatchlistSyncRun_status_completedAt_idx"
    ON "WatchlistSyncRun"("status", "completedAt" DESC);
