-- Part B §6/§7: a downloaded list generation is invisible until it is published.
--
-- THE PROBLEM THIS SOLVES
--
-- The sync upserted ~19,000 rows in chunks and then deleted whatever it had not
-- stamped. Neither step is a transaction, so a screening running during a sync
-- could observe a list that was partly the old generation and partly the new
-- one — including the window where an entry a subject WOULD have matched had
-- already been pruned but its replacement had not yet landed. A sanctions check
-- against a half-written list returns CLEAR, which is the exact failure this
-- module exists to prevent.
--
-- Entries are now written against a VERSION. A screening reads only the
-- PUBLISHED version. Writing happens entirely outside any reader's view;
-- publishing flips one row inside one transaction. A reader therefore sees the
-- old complete generation or the new complete generation, never a mixture.

CREATE TYPE "DatasetVersionStatus" AS ENUM (
    'DOWNLOADED', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED'
);

CREATE TABLE "WatchlistDatasetVersion" (
    "id" TEXT NOT NULL,
    "source" "WatchlistSource" NOT NULL,
    "status" "DatasetVersionStatus" NOT NULL DEFAULT 'DOWNLOADED',
    "version" TEXT NOT NULL,
    "recordCount" INTEGER,
    "addedCount" INTEGER,
    "checksum" TEXT,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "syncRunId" TEXT,
    "publishedByUserId" TEXT,
    "rolledBackFromId" TEXT,
    "rollbackReason" TEXT,

    CONSTRAINT "WatchlistDatasetVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchlistDatasetVersion_version_key"
    ON "WatchlistDatasetVersion"("version");
CREATE INDEX "WatchlistDatasetVersion_source_status_idx"
    ON "WatchlistDatasetVersion"("source", "status");
CREATE INDEX "WatchlistDatasetVersion_source_downloadedAt_idx"
    ON "WatchlistDatasetVersion"("source", "downloadedAt" DESC);

-- AT MOST ONE PUBLISHED GENERATION PER SOURCE.
--
-- This is the invariant the whole design rests on: if two generations were ever
-- published at once, a screening would read the union of both and the
-- atomicity guarantee would be silently gone. A partial UNIQUE index makes that
-- unrepresentable, rather than a check-then-write in the service that races
-- with itself (ibms-brain/meta/lex/race-safe-invariants.md).
CREATE UNIQUE INDEX "WatchlistDatasetVersion_one_published_per_source"
    ON "WatchlistDatasetVersion"("source") WHERE "status" = 'PUBLISHED';

-- A published or superseded generation was published at some point; a
-- downloaded or rejected one never was. Stops a row claiming a lifecycle state
-- its own timestamps contradict.
ALTER TABLE "WatchlistDatasetVersion"
    ADD CONSTRAINT "WatchlistDatasetVersion_published_has_timestamp"
    CHECK (
        ("status" IN ('PUBLISHED', 'SUPERSEDED') AND "publishedAt" IS NOT NULL)
        OR ("status" IN ('DOWNLOADED', 'VALIDATED', 'REJECTED') AND "publishedAt" IS NULL)
    );

-- A rejected generation states why. "Rejected" with no reason is
-- indistinguishable from a row somebody abandoned.
ALTER TABLE "WatchlistDatasetVersion"
    ADD CONSTRAINT "WatchlistDatasetVersion_rejected_has_reason"
    CHECK (
        "status" <> 'REJECTED'
        OR ("rejectedAt" IS NOT NULL AND length(btrim(coalesce("rejectionReason", ''))) > 0)
    );

-- A rollback is a person overriding the newest available list. It carries a
-- written reason, the same rule the screening match queue already enforces on
-- clearing or confirming a match.
ALTER TABLE "WatchlistDatasetVersion"
    ADD CONSTRAINT "WatchlistDatasetVersion_rollback_has_reason"
    CHECK (
        "rolledBackFromId" IS NULL
        OR length(btrim(coalesce("rollbackReason", ''))) > 0
    );

ALTER TABLE "WatchlistDatasetVersion"
    ADD CONSTRAINT "WatchlistDatasetVersion_recordCount_nonnegative"
    CHECK ("recordCount" IS NULL OR "recordCount" >= 0);

-- ---------------------------------------------------------------------------
-- WatchlistEntry now belongs to a generation.
-- ---------------------------------------------------------------------------

ALTER TABLE "WatchlistEntry" ADD COLUMN "datasetVersionId" TEXT;

-- Cascade: deleting a retired generation is exactly how its rows are reclaimed.
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_datasetVersionId_fkey"
    FOREIGN KEY ("datasetVersionId") REFERENCES "WatchlistDatasetVersion"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "WatchlistEntry_datasetVersionId_idx"
    ON "WatchlistEntry"("datasetVersionId");

-- ---------------------------------------------------------------------------
-- Adopt whatever is already in the table as the first PUBLISHED generation.
--
-- Without this, an existing deployment's entire synced cache becomes invisible
-- the moment this migration lands — every screening would return
-- UNABLE_TO_SCREEN until the next sync. That is the safe direction as failures
-- go, but it is a self-inflicted outage, and the rows on hand ARE the list that
-- was in force a moment ago.
-- ---------------------------------------------------------------------------

INSERT INTO "WatchlistDatasetVersion" (
    "id", "source", "status", "version", "recordCount",
    "downloadedAt", "validatedAt", "publishedAt"
)
SELECT
    gen_random_uuid()::text,
    e."source",
    'PUBLISHED'::"DatasetVersionStatus",
    e."source"::text || '@adopted-' || to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    count(*),
    coalesce(min(e."syncedAt"), now()),
    now(),
    now()
FROM "WatchlistEntry" e
WHERE e."datasetVersionId" IS NULL
GROUP BY e."source";

UPDATE "WatchlistEntry" e
SET "datasetVersionId" = v."id"
FROM "WatchlistDatasetVersion" v
WHERE e."datasetVersionId" IS NULL
  AND v."source" = e."source"
  AND v."status" = 'PUBLISHED';

-- The old uniqueness was (source, sourceRecordId). It has to become
-- generation-scoped: the same list entry legitimately exists in the published
-- generation and in the one being downloaded alongside it.
--
-- Dropped as an INDEX, not a CONSTRAINT: Prisma materialises `@@unique` as a
-- unique index, so `DROP CONSTRAINT IF EXISTS` silently no-ops against it and
-- leaves the old rule in force while the schema says otherwise — a divergence
-- this repository has been bitten by before (see migration 20260909160000).
DROP INDEX IF EXISTS "WatchlistEntry_source_sourceRecordId_key";
CREATE UNIQUE INDEX "WatchlistEntry_source_sourceRecordId_datasetVersionId_key"
    ON "WatchlistEntry"("source", "sourceRecordId", "datasetVersionId");
