-- Process 49 — fuzzy sanctions matching + a human review queue.
--
-- The exact matcher this supports replacing required a subject's name to be
-- token-identical to a watchlist entry, which silently missed both
-- transliteration variants (Muhammad/Mohammed) and Jordan's four-part naming
-- convention against two/three-part list entries. Both produced a CLEAR
-- result, the worst failure mode for a sanctions control.

-- The canonical token set matched against. Defaulted to an empty array so the
-- column is backfillable without locking: an entry written before this
-- migration is simply not fuzzy-matchable until the next sync rewrites it,
-- and exact matching on "normalizedName" still covers it in the meantime.
ALTER TABLE "WatchlistEntry"
  ADD COLUMN IF NOT EXISTS "canonicalTokens" TEXT[] NOT NULL DEFAULT '{}';

-- Screening asks "are ALL of this entry's tokens present in the subject's
-- tokens?" — array containment (<@). GIN is the index type that answers it.
CREATE INDEX IF NOT EXISTS "WatchlistEntry_canonicalTokens_idx"
  ON "WatchlistEntry" USING GIN ("canonicalTokens");

CREATE TABLE IF NOT EXISTS "ScreeningMatch" (
  "id"               TEXT NOT NULL,
  "kycRecordId"      TEXT NOT NULL,
  "watchlistEntryId" TEXT NOT NULL,
  "subjectName"      TEXT NOT NULL,
  "matchType"        TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'pending',
  "detectedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByUserId" TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "reviewReason"     TEXT,
  CONSTRAINT "ScreeningMatch_pkey" PRIMARY KEY ("id")
);

-- One open item per (KYC file, list entry, subject name). The recurring batch
-- re-screens every active customer every four hours; without this it would
-- mint a duplicate queue item on each pass. This is the race backstop, not a
-- findFirst check in application code (race-safe-invariants.md).
CREATE UNIQUE INDEX IF NOT EXISTS "ScreeningMatch_kycRecordId_watchlistEntryId_subjectName_key"
  ON "ScreeningMatch" ("kycRecordId", "watchlistEntryId", "subjectName");
CREATE INDEX IF NOT EXISTS "ScreeningMatch_status_idx" ON "ScreeningMatch" ("status");
CREATE INDEX IF NOT EXISTS "ScreeningMatch_kycRecordId_idx" ON "ScreeningMatch" ("kycRecordId");

ALTER TABLE "ScreeningMatch"
  ADD CONSTRAINT "ScreeningMatch_kycRecordId_fkey"
  FOREIGN KEY ("kycRecordId") REFERENCES "KYCRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE, unlike the KYC side: a watchlist entry is deleted when it drops off
-- the source list, and a queue item pointing at a delisted entry has nothing
-- left to review. The audit trail of the review decision survives in
-- AuditLogEntry, which is immutable and never cascades.
ALTER TABLE "ScreeningMatch"
  ADD CONSTRAINT "ScreeningMatch_watchlistEntryId_fkey"
  FOREIGN KEY ("watchlistEntryId") REFERENCES "WatchlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
