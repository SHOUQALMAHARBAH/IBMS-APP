-- Part C backlog #2 (Prospect Management) — the profile/list screen scopes
-- a Sales Officer to their own prospects the same way Lead's list/filter
-- does (see 20260826150000_add_lead_filter_indexes), so this filter column
-- gets the same treatment. No status index yet: unlike Lead, Prospect has
-- no workflow-engine status enum/transitions in this backlog item, so there
-- is no differentiated status value to filter by.

-- CreateIndex
CREATE INDEX "Prospect_salesOwnerUserId_idx" ON "Prospect"("salesOwnerUserId");
