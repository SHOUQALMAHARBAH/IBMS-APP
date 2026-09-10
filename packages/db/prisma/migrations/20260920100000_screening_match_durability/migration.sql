-- Process 49 — make a recorded sanctions-match decision durable, and make the
-- "no duplicate queue item" invariant actually hold.
--
-- Two defects in 20260919120000, both found by a @code-reviewer pass.

-- ===========================================================================
-- 1. A CONFIRMED match must survive the entry being de-listed.
-- ===========================================================================
--
-- ScreeningMatch_watchlistEntryId_fkey was ON DELETE CASCADE, and
-- WatchlistEntryRepository.pruneStale deletes every entry absent from the
-- latest successful sync. So the record that a Compliance Officer adjudicated
-- a real sanctions hit — their user id, the timestamp, and the written reason
-- that is the substance of the control — was silently destroyed the moment
-- OFAC or the UN de-listed the subject. It would also be destroyed wholesale
-- if a source ever changed its sourceRecordId scheme, because upsertMany would
-- then miss every row and pruneStale would delete the lot.
--
-- The original comment argued AuditLogEntry was the backstop. That makes the
-- audit log the ONLY copy of a compliance record the system otherwise holds as
-- first-class data, and it is not what a reviewer opening the queue can see.
--
-- Fix: snapshot the entry's identifying fields onto the match at detection
-- time, and SET NULL instead of CASCADE so the queue row outlives the entry.

ALTER TABLE "ScreeningMatch"
  ADD COLUMN IF NOT EXISTS "entrySource"         TEXT,
  ADD COLUMN IF NOT EXISTS "entrySourceRecordId" TEXT,
  ADD COLUMN IF NOT EXISTS "entryFullName"       TEXT,
  ADD COLUMN IF NOT EXISTS "entryListProgram"    TEXT;

-- Backfill from the live relation for any row that predates the snapshot.
-- (Both `db` and `db-test` hold zero rows at the time of writing — this is
-- defensive, so the migration is correct on a database that does have some.)
UPDATE "ScreeningMatch" m
   SET "entrySource"         = e."source"::TEXT,
       "entrySourceRecordId" = e."sourceRecordId",
       "entryFullName"       = e."fullName",
       "entryListProgram"    = e."listProgram"
  FROM "WatchlistEntry" e
 WHERE e."id" = m."watchlistEntryId"
   AND m."entryFullName" IS NULL;

-- A row whose entry has already been pruned cannot be recovered; mark it
-- rather than leaving a NULL that reads as "never populated".
UPDATE "ScreeningMatch"
   SET "entrySource"   = COALESCE("entrySource", 'UNKNOWN'),
       "entryFullName" = COALESCE("entryFullName", '(entry no longer on the source list)')
 WHERE "entryFullName" IS NULL;

ALTER TABLE "ScreeningMatch"
  ALTER COLUMN "entrySource"   SET NOT NULL,
  ALTER COLUMN "entryFullName" SET NOT NULL;

-- Now the FK can release the row instead of deleting it.
ALTER TABLE "ScreeningMatch" ALTER COLUMN "watchlistEntryId" DROP NOT NULL;
ALTER TABLE "ScreeningMatch" DROP CONSTRAINT IF EXISTS "ScreeningMatch_watchlistEntryId_fkey";
ALTER TABLE "ScreeningMatch"
  ADD CONSTRAINT "ScreeningMatch_watchlistEntryId_fkey"
  FOREIGN KEY ("watchlistEntryId") REFERENCES "WatchlistEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- 2. The "one queue item per subject" unique keyed on the RAW name.
-- ===========================================================================
--
-- ScreeningMatch_kycRecordId_watchlistEntryId_subjectName_key used
-- "subjectName" verbatim — Customer.legalName / UBO.fullName as typed. The
-- match itself is made on the CANONICAL token set, so the constraint did not
-- express the invariant its own comment claimed.
--
-- Concretely: a customer screened as "Ahmad Al-Hashimi" gets a queue item, a
-- Compliance Officer CLEARS it with a written reason, and someone later tidies
-- the legal name to "Ahmad Al Hashimi" (or re-cases it, or leaves a trailing
-- space). The next 4-hourly batch canonicalises to the identical token set,
-- matches the same entry — and mints a SECOND pending item, because the raw
-- name differs. The cleared decision does not suppress it, and every further
-- whitespace or casing variant mints another.
--
-- Fix: key on the canonical form. `subjectName` stays, display-only, because a
-- reviewer needs to see which subject actually triggered the match and in what
-- spelling.

ALTER TABLE "ScreeningMatch" ADD COLUMN IF NOT EXISTS "subjectCanonical" TEXT;

-- Backfill approximation for pre-existing rows: lower-case, strip punctuation,
-- de-duplicate and sort. This deliberately does NOT apply the transliteration
-- collapsing that canonicalNameTokens() does — that table is TypeScript and
-- not reproducible in SQL. The consequence is bounded and one-off: a
-- pre-existing row whose name contains a transliterated given name may not
-- dedupe against a newly-detected one until it is next re-screened. Both
-- databases hold zero rows, so in practice this backfills nothing.
UPDATE "ScreeningMatch"
   SET "subjectCanonical" = COALESCE((
         SELECT string_agg(DISTINCT t, ' ' ORDER BY t)
           FROM unnest(
                  string_to_array(
                    regexp_replace(lower("subjectName"), '[^[:alnum:][:space:]]', ' ', 'g'),
                    ' '
                  )
                ) AS t
          WHERE t <> ''
       ), '')
 WHERE "subjectCanonical" IS NULL;

ALTER TABLE "ScreeningMatch" ALTER COLUMN "subjectCanonical" SET NOT NULL;

DROP INDEX IF EXISTS "ScreeningMatch_kycRecordId_watchlistEntryId_subjectName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ScreeningMatch_kycRecordId_watchlistEntryId_subjectCanonical_key"
  ON "ScreeningMatch" ("kycRecordId", "watchlistEntryId", "subjectCanonical");

-- NOTE on the nullable FK column above: Postgres treats NULLs as distinct in a
-- unique index, so once an entry is de-listed and watchlistEntryId goes NULL,
-- that historical row no longer participates in the constraint. That is the
-- correct trade: the row is already reviewed and is being kept as a record,
-- and if the same subject is re-listed later it SHOULD raise a fresh item for
-- a fresh decision rather than being silently suppressed by an old one.
