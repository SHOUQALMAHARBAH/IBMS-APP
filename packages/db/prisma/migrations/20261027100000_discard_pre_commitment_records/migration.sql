-- DISCARD — a way out of a pre-commitment record raised in error. Class B, piece 1.
--
-- THE TRAP THIS REMOVES
-- ---------------------
-- Measured across four modules: there was no route out of any pre-commitment state. The sharpest case is the
-- endorsement — the only exit from a wrongly raised one was to APPLY it, altering a real policy, its premium
-- and its commission, and then correct it with a second endorsement. To undo the mistake you had to commit
-- it first. A broker's first bad keystroke was permanent.
--
-- WHAT IS ADDED
-- -------------
-- Three columns on each of the four entities, and a CHECK per entity that makes them all-or-nothing. The
-- reason is MANDATORY because it is the only part of a discard nobody can reconstruct later: who and when
-- are recoverable from an audit row, "why" is not.
--
-- Nothing is deleted and nothing is rewritten. A discarded row stays exactly where it was, marked.
--
-- AND THE CONSTRAINT CHANGE THE DISCARD FORCED
-- --------------------------------------------
-- `Recommendation.opportunityId` and `recommendedQuotationId` were plain UNIQUE. A discarded recommendation
-- would then block its own replacement for ever: a broker unable to write a second recommendation because
-- the first was a typo — the same trap, one table over. Both become PARTIAL unique indexes over live rows
-- only, which is the shape already used for a department's or a branch's name: retiring one frees it.
--
-- Prisma cannot express a partial index, so these live here and assert themselves below. `db:divergence`
-- cannot see partial indexes OR check constraints, which is why every object this migration creates is
-- verified in its own DO block rather than trusted to a gate.

-- ---------------------------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "Policy"
  ADD COLUMN "discardedAt" TIMESTAMP(3),
  ADD COLUMN "discardedByUserId" TEXT,
  ADD COLUMN "discardedReason" TEXT;

ALTER TABLE "Claim"
  ADD COLUMN "discardedAt" TIMESTAMP(3),
  ADD COLUMN "discardedByUserId" TEXT,
  ADD COLUMN "discardedReason" TEXT;

ALTER TABLE "Endorsement"
  ADD COLUMN "discardedAt" TIMESTAMP(3),
  ADD COLUMN "discardedByUserId" TEXT,
  ADD COLUMN "discardedReason" TEXT;

ALTER TABLE "Recommendation"
  ADD COLUMN "discardedAt" TIMESTAMP(3),
  ADD COLUMN "discardedByUserId" TEXT,
  ADD COLUMN "discardedReason" TEXT;

-- ---------------------------------------------------------------------------
-- 2. All three together, or none. The reason is not optional.
-- ---------------------------------------------------------------------------
-- Written as a three-way agreement rather than "reason IS NOT NULL when discardedAt IS NOT NULL", so that a
-- reason or an actor arriving WITHOUT a discard is refused too — a half-written discard is as unreadable
-- from either side.
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_discard_all_or_nothing" CHECK (
  ("discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardedReason" IS NULL)
  OR ("discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL AND length(btrim("discardedReason")) >= 10)
);

ALTER TABLE "Claim" ADD CONSTRAINT "Claim_discard_all_or_nothing" CHECK (
  ("discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardedReason" IS NULL)
  OR ("discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL AND length(btrim("discardedReason")) >= 10)
);

ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_discard_all_or_nothing" CHECK (
  ("discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardedReason" IS NULL)
  OR ("discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL AND length(btrim("discardedReason")) >= 10)
);

ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_discard_all_or_nothing" CHECK (
  ("discardedAt" IS NULL AND "discardedByUserId" IS NULL AND "discardedReason" IS NULL)
  OR ("discardedAt" IS NOT NULL AND "discardedByUserId" IS NOT NULL AND length(btrim("discardedReason")) >= 10)
);

-- ---------------------------------------------------------------------------
-- 3. The two uniques become partial: live rows only.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "Recommendation_opportunityId_key";
DROP INDEX IF EXISTS "Recommendation_recommendedQuotationId_key";

CREATE UNIQUE INDEX "Recommendation_opportunityId_live_key"
  ON "Recommendation" ("opportunityId")
  WHERE "discardedAt" IS NULL;

CREATE UNIQUE INDEX "Recommendation_recommendedQuotationId_live_key"
  ON "Recommendation" ("recommendedQuotationId")
  WHERE "discardedAt" IS NULL;

-- A plain index on each column, because the unique no longer covers the discarded rows and reading a
-- recommendation's history by opportunity is the point of keeping them.
CREATE INDEX IF NOT EXISTS "Recommendation_opportunityId_idx" ON "Recommendation" ("opportunityId");
CREATE INDEX IF NOT EXISTS "Recommendation_recommendedQuotationId_idx" ON "Recommendation" ("recommendedQuotationId");

-- ---------------------------------------------------------------------------
-- 4. Prove every object exists, and prove the partial indexes are PARTIAL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
  not_partial text;
BEGIN
  SELECT string_agg(expected, ', ') INTO missing
  FROM (
    VALUES
      ('Policy_discard_all_or_nothing'),
      ('Claim_discard_all_or_nothing'),
      ('Endorsement_discard_all_or_nothing'),
      ('Recommendation_discard_all_or_nothing')
  ) AS wanted(expected)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = wanted.expected AND contype = 'c'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'discard: CHECK constraint(s) missing after the migration: %', missing;
  END IF;

  SELECT string_agg(expected, ', ') INTO missing
  FROM (
    VALUES
      ('Recommendation_opportunityId_live_key'),
      ('Recommendation_recommendedQuotationId_live_key')
  ) AS wanted(expected)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = wanted.expected AND relkind = 'i'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'discard: partial unique index(es) missing: %', missing;
  END IF;

  -- The half that matters. A unique index created WITHOUT the predicate would look identical in a listing
  -- and would reproduce the very trap this migration removes: a discarded recommendation blocking its
  -- replacement. `indpred IS NOT NULL` is what says the index is partial.
  SELECT string_agg(cls.relname, ', ') INTO not_partial
  FROM pg_index idx
  JOIN pg_class cls ON cls.oid = idx.indexrelid
  WHERE cls.relname IN (
    'Recommendation_opportunityId_live_key',
    'Recommendation_recommendedQuotationId_live_key'
  )
    AND idx.indpred IS NULL;
  IF not_partial IS NOT NULL THEN
    RAISE EXCEPTION
      'discard: index(es) % are unique but NOT partial — a discarded recommendation would block its own replacement, which is the trap this migration exists to remove.',
      not_partial;
  END IF;

  -- And the old full uniques are gone, or the partial ones are decoration.
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname IN ('Recommendation_opportunityId_key', 'Recommendation_recommendedQuotationId_key')
  ) THEN
    RAISE EXCEPTION 'discard: the original full UNIQUE index on Recommendation survived — the partial index cannot take effect while it stands.';
  END IF;
END $$;
