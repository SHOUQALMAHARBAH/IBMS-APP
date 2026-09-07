-- Backlog Part C #17 — Client Decision Handling. The `ClientDecision` model
-- already existed (big migration 20260825124114) with `opportunityId @unique`,
-- `decision`, `evidenceType`, `evidenceRef`, `decidedAt`. This adds the
-- officer-context + provenance columns #17 records.
ALTER TABLE "ClientDecision" ADD COLUMN "notes" TEXT;
ALTER TABLE "ClientDecision" ADD COLUMN "capturedByUserId" TEXT;
