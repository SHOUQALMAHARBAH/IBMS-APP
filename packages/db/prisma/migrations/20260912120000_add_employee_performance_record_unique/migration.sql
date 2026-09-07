-- Process 61 (backlog Part C #61, Domain G — Employee Performance). A
-- monthly periodic job snapshots one EmployeePerformanceRecord row per
-- employee per periodLabel; a recompute for the same employee+period must
-- UPSERT rather than accumulate a stray duplicate snapshot. Both columns
-- are always non-null here, so (like InsurerPerformanceScore, unlike
-- SalesTarget) this is a plain composite unique index, no partial-index
-- NULL gotcha.

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePerformanceRecord_employeeId_periodLabel_key" ON "EmployeePerformanceRecord"("employeeId", "periodLabel");
