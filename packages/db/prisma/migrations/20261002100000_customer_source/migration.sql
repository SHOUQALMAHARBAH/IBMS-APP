-- Part III §7 (Phase 5) — provenance for a Customer row, so a record loaded
-- from an office's legacy spreadsheet is never mistaken for one that went
-- through this platform's own maker/checker KYC.
--
-- Defaults to PLATFORM: every row that exists today was created through the
-- intake flow, which is exactly what PLATFORM means. Backfill is therefore the
-- default itself, not a separate UPDATE.

CREATE TYPE "CustomerSource" AS ENUM ('PLATFORM', 'LEGACY_IMPORT');

ALTER TABLE "Customer"
  ADD COLUMN "source" "CustomerSource" NOT NULL DEFAULT 'PLATFORM';

-- No new table, so the RLS policy count must be unchanged. Asserted rather
-- than assumed: §1's standing rule is that the application layer picks up a new
-- tenant-scoped model automatically and the database layer does not, so every
-- migration states which side of that line it falls on.
DO $$
DECLARE policies integer;
BEGIN
  SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'public';
  IF policies <> 119 THEN
    RAISE EXCEPTION 'Expected 119 RLS policies, found %', policies;
  END IF;
END $$;
