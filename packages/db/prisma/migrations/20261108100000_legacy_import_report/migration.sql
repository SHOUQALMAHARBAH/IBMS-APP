-- THE IMPORT'S REPORT OUTLIVES ITS HTTP RESPONSE.
--
-- WHAT WAS THERE
-- --------------
-- `LegacyImportService.import` returned `{ imported, rejected, screened, screeningFlagged,
-- rejections[], failures[] }` in the response body, plus one audit row carrying the COUNTS. Nothing
-- durable held the LINES. An office importing 2,000 rows got forty refusals in a response they could
-- read once and never come back to.
--
-- AND A CORRECTION TO MY OWN EARLIER REPORT: I described this as belonging "in the LegacyImportBatch
-- record the module already keeps". **There was no such model.** I named one that did not exist and the
-- instruction then carried the error forward. There is one now, created here.
--
-- WHY THE KIND IS AN ENUM AND NOT A SENTENCE
-- ------------------------------------------
-- The requirement is that a row refused for a DUPLICATE is reported differently from one refused for
-- BAD DATA — one needs an identity decision from a person, the other a typo fixed. As prose that decays
-- into two messages that read alike and a screen that lists them together. As an enum it is
-- machine-checkable: a test can assert the kinds, a screen can filter on them, and "forty rows failed"
-- cannot be what an office is handed.
--
-- `IMPORTED_NEEDS_REVIEW` is the third kind and is kept apart from both refusals because the customer
-- IS in the book — screening failed, or its candidate queue was truncated. Folding it in with the
-- rejections would understate what was written, which is the opposite of the error this table exists to
-- prevent.
CREATE TYPE "LegacyImportIssueKind" AS ENUM ('DUPLICATE', 'BAD_DATA', 'IMPORTED_NEEDS_REVIEW');

CREATE TABLE "LegacyImportBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "actorUserId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalDataRows" INTEGER NOT NULL,
  "imported" INTEGER NOT NULL,
  "refused" INTEGER NOT NULL,
  "screened" INTEGER NOT NULL,
  "needsReview" INTEGER NOT NULL,
  CONSTRAINT "LegacyImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyImportIssue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "batchId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "kind" "LegacyImportIssueKind" NOT NULL,
  "detail" TEXT NOT NULL,
  "collidedWithCustomerId" TEXT,
  CONSTRAINT "LegacyImportIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegacyImportBatch_organizationId_startedAt_idx"
  ON "LegacyImportBatch" ("organizationId", "startedAt" DESC);
CREATE INDEX "LegacyImportBatch_actorUserId_idx" ON "LegacyImportBatch" ("actorUserId");
CREATE INDEX "LegacyImportIssue_batchId_kind_idx" ON "LegacyImportIssue" ("batchId", "kind");
CREATE INDEX "LegacyImportIssue_organizationId_idx" ON "LegacyImportIssue" ("organizationId");

ALTER TABLE "LegacyImportBatch"
  ADD CONSTRAINT "LegacyImportBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LegacyImportIssue"
  ADD CONSTRAINT "LegacyImportIssue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE from the batch: an issue has no meaning without the run it belongs to.
ALTER TABLE "LegacyImportIssue"
  ADD CONSTRAINT "LegacyImportIssue_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "LegacyImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not RESTRICT, and the difference matters: the report is a record of what HAPPENED, and a
-- customer discarded months later must not make a historical report undeletable. The line number and
-- the reason survive; only the link goes.
ALTER TABLE "LegacyImportIssue"
  ADD CONSTRAINT "LegacyImportIssue_collidedWithCustomerId_fkey"
  FOREIGN KEY ("collidedWithCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Both tables carry `organizationId`, which is what makes them scopeable at all: `tenantScopeExtension`
-- sets `app.current_org_id` only for models that carry it, so a policy on a table without it matches
-- nothing, forever. (That outage is recorded — an RLS policy joined through a parent table could never
-- be satisfied and every permission read returned empty.)
ALTER TABLE "LegacyImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyImportBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LegacyImportBatch_tenant_isolation" ON "LegacyImportBatch"
  USING ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "LegacyImportIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyImportIssue" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LegacyImportIssue_tenant_isolation" ON "LegacyImportIssue"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- Asserted here, because `db:divergence` sees neither RLS nor a policy — measured: adding an RLS table
-- left it reporting "20 statements, 20 expected". So RLS joins partial indexes and CHECK constraints as
-- a third class the gate cannot reach, and the migration asserts its own.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename IN ('LegacyImportBatch', 'LegacyImportIssue');
  IF n <> 2 THEN
    RAISE EXCEPTION 'legacy-import-report: expected 2 tenant-isolation policies, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND c.relname IN ('LegacyImportBatch', 'LegacyImportIssue')
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF n <> 2 THEN
    RAISE EXCEPTION
      'legacy-import-report: RLS is not FORCED on both tables (found %). Postgres exempts a table OWNER from its own policies, so ENABLE without FORCE is isolation the runtime role does not actually get.',
      n;
  END IF;

  -- The enum must carry exactly three values. A fourth added later without a reader is the
  -- `UNENFORCED` shape; a third removed would silently merge two kinds the screen separates.
  SELECT count(*) INTO n FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'LegacyImportIssueKind';
  IF n <> 3 THEN
    RAISE EXCEPTION 'legacy-import-report: LegacyImportIssueKind has % values, expected 3', n;
  END IF;
END $$;
