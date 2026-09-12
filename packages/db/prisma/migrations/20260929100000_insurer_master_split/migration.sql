-- Part I §5 (multi-tenancy Phase 3 step 10) — split the insurer registry into
-- GLOBAL master data and the per-office relationship row.
--
-- Two offices dealing with the same real insurance company must see the same
-- company (and reuse the same mapped submission form) while their negotiated
-- commercial terms stay invisible to each other. `InsurerMaster` carries the
-- identity; `Insurer` keeps everything that genuinely differs per office.
--
-- HAND-AUTHORED, NOT `prisma migrate dev` OUTPUT — and the difference matters.
-- Prisma's own diff for this change wanted to:
--   * DROP the three `searchVector` GIN indexes, the `canonicalTokens` GIN
--     index and four screening indexes, all created in raw SQL it cannot model;
--   * DROP DEFAULT on the three GENERATED `searchVector` columns (Postgres
--     refuses this outright) and on `WatchlistEntry.canonicalTokens`;
--   * rename one unrelated pre-existing index.
-- All of that is pre-existing drift, unrelated to this change, and stripped —
-- the same audit Phase 1's migration records. Drift before vs. after this
-- migration is byte-identical.
--
-- It also wanted to `ADD COLUMN "insurerMasterId" TEXT NOT NULL` in the same
-- statement that DROPs `name` — which would both fail against existing rows
-- and destroy the very data the masters have to be built from. The ordering
-- below (add nullable, backfill, verify, then constrain) is the whole point of
-- the spec's "migrate it column-by-column rather than dropping and recreating".

-- CreateEnum
CREATE TYPE "InsurerFormFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'ENUM', 'BOOLEAN');

-- CreateTable
CREATE TABLE "InsurerMaster" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalNameAr" TEXT,
    "linesOffered" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsurerMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurerFormTemplate" (
    "id" TEXT NOT NULL,
    "insurerMasterId" TEXT NOT NULL,
    "insuranceLine" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceDocumentRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurerFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurerFormField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT,
    "dataType" "InsurerFormFieldType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "displayOrder" INTEGER NOT NULL,

    CONSTRAINT "InsurerFormField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsurerMaster_legalName_key" ON "InsurerMaster"("legalName");
CREATE INDEX "InsurerFormTemplate_insurerMasterId_idx" ON "InsurerFormTemplate"("insurerMasterId");
CREATE UNIQUE INDEX "InsurerFormTemplate_insurerMasterId_insuranceLine_version_key" ON "InsurerFormTemplate"("insurerMasterId", "insuranceLine", "version");
CREATE INDEX "InsurerFormField_templateId_idx" ON "InsurerFormField"("templateId");
CREATE UNIQUE INDEX "InsurerFormField_templateId_fieldKey_key" ON "InsurerFormField"("templateId", "fieldKey");

-- AddForeignKey
ALTER TABLE "InsurerFormTemplate" ADD CONSTRAINT "InsurerFormTemplate_insurerMasterId_fkey" FOREIGN KEY ("insurerMasterId") REFERENCES "InsurerMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerFormField" ADD CONSTRAINT "InsurerFormField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "InsurerFormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Insurer: add the new shape alongside the old, NULLABLE for now.
-- ---------------------------------------------------------------------------
ALTER TABLE "Insurer"
  ADD COLUMN "insurerMasterId"    TEXT,
  ADD COLUMN "rfqContactName"     TEXT,
  ADD COLUMN "rfqContactEmail"    TEXT,
  ADD COLUMN "rfqContactPhone"    TEXT,
  ADD COLUMN "claimsContactName"  TEXT,
  ADD COLUMN "claimsContactEmail" TEXT,
  ADD COLUMN "isActive"           BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Backfill 1 — one master per distinct legal name, PLATFORM-WIDE.
--
-- Deliberately grouped by name across every Organization, not per office: the
-- whole point of §5 is that two offices dealing with the same company converge
-- on one row. With a single Organization live today this is equivalent to a
-- 1:1 carry-over, and it was verified beforehand that no `(organizationId,
-- name)` pair is duplicated in either database, so no office can end up with
-- two relationship rows pointing at the same master.
--
-- `min(nameAr)` picks a deterministic Arabic name where rows for the same
-- company disagree; NULLs sort last, so a real name always wins over a NULL.
-- ---------------------------------------------------------------------------
INSERT INTO "InsurerMaster" ("id", "legalName", "legalNameAr", "linesOffered", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  i."name",
  min(i."nameAr"),
  COALESCE(
    (SELECT array_agg(DISTINCT p."insuranceLine" ORDER BY p."insuranceLine")
       FROM "InsurerProduct" p
       JOIN "Insurer" i2 ON i2."id" = p."insurerId"
      WHERE i2."name" = i."name"),
    ARRAY[]::text[]
  ),
  min(i."createdAt"),
  NOW()
FROM "Insurer" i
GROUP BY i."name";

-- Backfill 2 — point each office's relationship row at its master, and move
-- the contact columns across. `claimsContact` is a single free-text column
-- today and every populated value in both databases is email-shaped, so it is
-- routed by content rather than assumed to be one or the other.
UPDATE "Insurer" i
   SET "insurerMasterId"    = m."id",
       "rfqContactEmail"    = i."contactEmail",
       "rfqContactPhone"    = i."contactPhone",
       "claimsContactEmail" = CASE WHEN i."claimsContact" LIKE '%@%' THEN i."claimsContact" END,
       "claimsContactName"  = CASE WHEN i."claimsContact" NOT LIKE '%@%' THEN i."claimsContact" END
  FROM "InsurerMaster" m
 WHERE m."legalName" = i."name";

-- Refuse to continue if anything failed to map. A NULL here would become a
-- NOT NULL violation two statements later with no indication of which rows;
-- failing loudly now names the count.
DO $$
DECLARE orphans integer;
BEGIN
  SELECT count(*) INTO orphans FROM "Insurer" WHERE "insurerMasterId" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'insurer master backfill missed % Insurer row(s)', orphans;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Now the old shape can go, and the new one can be constrained.
-- ---------------------------------------------------------------------------
ALTER TABLE "Insurer" ALTER COLUMN "insurerMasterId" SET NOT NULL;

ALTER TABLE "Insurer"
  DROP COLUMN "name",
  DROP COLUMN "nameAr",
  DROP COLUMN "contactEmail",
  DROP COLUMN "contactPhone",
  DROP COLUMN "claimsContact";

-- CreateIndex
CREATE INDEX "Insurer_insurerMasterId_idx" ON "Insurer"("insurerMasterId");
CREATE UNIQUE INDEX "Insurer_organizationId_insurerMasterId_key" ON "Insurer"("organizationId", "insurerMasterId");

-- AddForeignKey
ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_insurerMasterId_fkey" FOREIGN KEY ("insurerMasterId") REFERENCES "InsurerMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The runtime role.
--
-- `ALTER DEFAULT PRIVILEGES` from migration 20260928100000 already covers
-- tables created by `ibms`, which is what runs this file — these GRANTs are
-- explicit anyway, because a missing grant on a new table surfaces as a
-- permission error in the running API rather than here.
--
-- NO ROW LEVEL SECURITY on the three new tables, deliberately: they are §3.1
-- GLOBAL models with no `organizationId`, exactly like `Role`/`Permission` and
-- the watchlist cache. A policy keyed to `app.current_org_id` would make the
-- shared master data invisible to everyone, which is the opposite of §5.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "InsurerMaster"        TO ibms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "InsurerFormTemplate"  TO ibms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "InsurerFormField"     TO ibms_app;
