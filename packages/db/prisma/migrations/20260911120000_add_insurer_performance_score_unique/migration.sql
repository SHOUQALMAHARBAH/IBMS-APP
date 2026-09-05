-- Process 60 (backlog Part C #60, Domain G — Insurer Performance). A
-- monthly periodic job snapshots one InsurerPerformanceScore row per insurer
-- per periodLabel; a recompute for the same insurer+period must UPSERT
-- rather than accumulate a stray duplicate snapshot. Both columns are always
-- non-null here, so (unlike SalesTarget's owner-xor-branch shape) this is a
-- plain composite unique index, no partial-index NULL gotcha.

-- CreateIndex
CREATE UNIQUE INDEX "InsurerPerformanceScore_insurerId_periodLabel_key" ON "InsurerPerformanceScore"("insurerId", "periodLabel");
