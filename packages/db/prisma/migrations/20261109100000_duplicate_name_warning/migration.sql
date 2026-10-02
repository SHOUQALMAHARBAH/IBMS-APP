-- LAYER 1: the create screen asks whether this is the same person, and the ANSWER IS RECORDED.
--
-- Created 2026-10-02. `DuplicateNameWarning` did not exist before this migration.
--
-- ============================================================================================
-- LAYER 1 DOES NOT PREVENT, AND LAYER 2 IS DELIBERATELY NOT BUILT
-- ============================================================================================
-- Stated here because a later reader must not mistake the warning for the whole control.
--
-- The officer may answer "a different person" and proceed; the customer is written. That is the design
-- rather than a shortcoming — two real people share a name, 7 of dev's 1,634 individuals collide on the
-- ordered key, and a hard block on the create screen would refuse a real customer. The HARD refusal
-- lives on the bulk import, where there is nobody to ask.
--
-- LAYER 2 — a KEYED fingerprint of the identity number, giving an exact-duplicate block — is deferred
-- by owner decision, with its wake condition written rather than left open:
--
--     "layer 2 wakes when A DUPLICATE IS DISCOVERED THAT THE NAME CHECK DID NOT WARN ABOUT — at which
--      point the gap is measured rather than estimated. And the whole decision is re-read before the
--      system holds real customer data at scale."
--
-- Neither layer suffices alone and the documentation must say so: the warning does not prevent, and the
-- fingerprint would catch neither a typo in a number nor a person holding no number at all.
--
-- For the record, so it is not re-derived if layer 2 is ever built: the key would be a SEPARATE key from
-- the data-encryption key, registered in the existing encryption-key registry under its own purpose.
-- Never the same key as the data encryption — rotating that is normal practice and would silently
-- invalidate every fingerprint, and therefore the index built on them.
--
-- ============================================================================================
-- WHY A TABLE AND NOT A FLAG — the instrumentation IS the point
-- ============================================================================================
-- The owner's decision was to build layer 1, measure its effect, and let the NUMBER decide whether the
-- fingerprint earns its key-management burden. That number is "how often did the warning fire, and how
-- often did the officer answer same person". A boolean on `Customer` could answer neither: it would
-- record only the creates that proceeded, losing every case where the warning WORKED and the officer
-- abandoned the create — which is the outcome the warning exists to produce.
--
-- So `createdCustomerId` is NULLABLE, and that null is the successful case.
CREATE TABLE "DuplicateNameWarning" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "actorUserId" TEXT NOT NULL,
  -- `canonical_person_key` of the name being entered — the ORDERED key, since the sorted one merges two
  -- cousins. Stored so the measurement can tell one name warning repeatedly from many distinct ones
  -- warning once; those two produce the same count and mean different things.
  "canonicalKey" TEXT NOT NULL,
  "matchCount" INTEGER NOT NULL,
  "samePerson" BOOLEAN NOT NULL,
  "createdCustomerId" TEXT,
  "warnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuplicateNameWarning_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DuplicateNameWarning_organizationId_warnedAt_idx"
  ON "DuplicateNameWarning" ("organizationId", "warnedAt" DESC);
CREATE INDEX "DuplicateNameWarning_canonicalKey_idx" ON "DuplicateNameWarning" ("canonicalKey");
-- Indexed because the wake-condition question is "how many said same person", which is a filter on it.
CREATE INDEX "DuplicateNameWarning_samePerson_idx" ON "DuplicateNameWarning" ("samePerson");

ALTER TABLE "DuplicateNameWarning"
  ADD CONSTRAINT "DuplicateNameWarning_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL: the warning is a record of a decision an officer took, and it must survive the customer
-- being discarded later. The answer and the count are the measurement; the link is a convenience.
ALTER TABLE "DuplicateNameWarning"
  ADD CONSTRAINT "DuplicateNameWarning_createdCustomerId_fkey"
  FOREIGN KEY ("createdCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DuplicateNameWarning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DuplicateNameWarning" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DuplicateNameWarning_tenant_isolation" ON "DuplicateNameWarning"
  USING ("organizationId" = current_setting('app.current_org_id', true));

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'DuplicateNameWarning';
  IF n <> 1 THEN
    RAISE EXCEPTION 'duplicate-name-warning: expected 1 tenant-isolation policy, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = 'DuplicateNameWarning'
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'duplicate-name-warning: RLS is not FORCED. Postgres exempts a table OWNER from its own policies, so ENABLE without FORCE is isolation the runtime role does not get.';
  END IF;

  -- `createdCustomerId` MUST be nullable. A NOT NULL here would make the successful outcome —
  -- the officer abandoning the create — unrecordable, and the measurement would then count only the
  -- times the warning was ignored, which is the opposite of what it exists to answer.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'DuplicateNameWarning'
       AND column_name = 'createdCustomerId'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'duplicate-name-warning: createdCustomerId must be NULLABLE — a null is the case where the warning WORKED and the officer did not create the duplicate';
  END IF;
END $$;
