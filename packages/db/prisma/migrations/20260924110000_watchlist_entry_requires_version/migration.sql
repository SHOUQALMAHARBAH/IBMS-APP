-- Part B §6: every watchlist entry belongs to a generation.
--
-- Nullable was wrong on two counts. An entry with no generation is invisible to
-- the published-generation reader, so it would sit in the table contributing
-- nothing while looking like coverage. And Postgres treats NULLs as distinct in
-- a unique index, so such rows are exempt from
-- (source, sourceRecordId, datasetVersionId) and could silently duplicate.
--
-- Safe here because the preceding migration adopted every pre-existing row into
-- a PUBLISHED generation. The guard below turns any row it somehow missed into
-- a loud failure rather than a silent NOT NULL violation mid-statement.
DO $$
DECLARE orphans bigint;
BEGIN
    SELECT count(*) INTO orphans FROM "WatchlistEntry" WHERE "datasetVersionId" IS NULL;
    IF orphans > 0 THEN
        RAISE EXCEPTION
            'Cannot require WatchlistEntry.datasetVersionId: % row(s) still have none. The 20260924100000 adoption step should have assigned every row; investigate before forcing this.',
            orphans;
    END IF;
END $$;

ALTER TABLE "WatchlistEntry" ALTER COLUMN "datasetVersionId" SET NOT NULL;
