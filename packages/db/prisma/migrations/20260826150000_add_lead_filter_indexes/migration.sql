-- Part C backlog #1 (Lead Management) — "List/filter by source and owner".
-- Matches this schema's existing convention (e.g. Policy/Claim @@index on
-- their own filterable columns) rather than inventing a composite index
-- ahead of real query patterns (backlog Part B.3 leaves broader
-- perf-index work blocked pending a load test).

-- CreateIndex
CREATE INDEX "Lead_ownerUserId_idx" ON "Lead"("ownerUserId");

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
