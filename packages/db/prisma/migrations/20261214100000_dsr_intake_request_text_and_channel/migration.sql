-- OWNER DECISION — a data subject request records WHAT WAS ASKED FOR and HOW IT ARRIVED.
--
-- WHAT WAS MISSING
-- ----------------
-- `DataSubjectRequest` carried the TYPE (`ACCESS`, `ERASURE`, …) and nothing about the request
-- itself. So a row said *access* and nothing about WHICH data, and whoever fulfils it two weeks
-- later cannot know what to fulfil. There was no attachment either, and no record of the channel —
-- while the approved procedure requires the request to be logged the same business day
-- "regardless of channel", which makes the channel a fact a regulator asks for.
--
-- `receivedAt` already carries a comment saying exactly that (*logged same business day regardless
-- of channel*), which is the clearest evidence the channel was meant to be here: the model named
-- the obligation and never stored the value.
--
-- BOTH COLUMNS ARE NULLABLE, AND NO CHECK REQUIRES THEM — THE REASON IS MEASURED
-- -----------------------------------------------------------------------------
-- The decision is *required for new rows; existing rows are not backfilled and must still read,
-- list and close*. Three shapes were considered and two are wrong:
--
--   NOT NULL             impossible without backfilling, and a backfill here would INVENT what a
--                        data subject asked for — on the record that proves a statutory right was
--                        answered. That is the worst available outcome.
--   CHECK … NOT VALID    enforced on every INSERT **and UPDATE**, never retro-validated. It is the
--                        shape `IncidentReport_impact_assessment_complete` uses, and it is wrong
--                        HERE: measured on db-test, **18 pre-existing requests of which 14 are
--                        OPEN**, and closing one is an UPDATE. The CHECK would refuse the closure
--                        of exactly the rows the decision says must still close.
--   nullable + DTO       what ships. Every request logged through `POST /dsr` carries both because
--                        `CreateDsrDto` makes them required; the eighteen that predate this read,
--                        list and close untouched.
--
-- SO THE LIMIT IS STATED RATHER THAN ENFORCED, and it is a real one: a future write path that
-- bypasses the DTO can create a row with neither. The DTO is the only guard, which is why the api
-- e2e asserts both refusals one at a time — a single request missing both would pass while only one
-- rule was still enforced.
--
-- THE ASSERTIONS BELOW INCLUDE ONE BY ABSENCE, which is the only form that can fail: a later
-- migration adding a NOT NULL or a CHECK on either column would silently take the closure path away
-- from those fourteen open requests.

CREATE TYPE "DsrIntakeChannel" AS ENUM (
  -- The four the decision names. `POST` is the postal channel («بريد»), not an HTTP verb — the
  -- ambiguity is noted because this codebase is full of the other sense, and the Arabic is what
  -- settles which is meant.
  'POST',
  'TELEPHONE',
  'IN_PERSON',
  'WEBSITE_FORM'
);

ALTER TABLE "DataSubjectRequest"
  ADD COLUMN "requestText" TEXT,
  ADD COLUMN "intakeChannel" "DsrIntakeChannel";

DO $$
DECLARE
  members     text;
  nullable    integer;
  constrained text;
  legacy      integer;
BEGIN
  -- (1) EXACTLY THE FOUR, IN ENUM SORT ORDER. A count of four is satisfied by a typo; the member
  -- list is not. Same shape as `20261209100000`'s four retrieval bases.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO members
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'DsrIntakeChannel';
  IF members <> 'POST,TELEPHONE,IN_PERSON,WEBSITE_FORM' THEN
    RAISE EXCEPTION 'DSR intake: expected exactly POST,TELEPHONE,IN_PERSON,WEBSITE_FORM — found %', members;
  END IF;

  -- (2) BOTH COLUMNS NULLABLE. Asserted rather than assumed, because the obvious "improvement" to
  -- this migration is a NOT NULL, and it cannot be added without inventing what somebody asked for.
  SELECT count(*) INTO nullable
  FROM information_schema.columns
  WHERE table_name = 'DataSubjectRequest'
    AND column_name IN ('requestText', 'intakeChannel')
    AND is_nullable = 'YES';
  IF nullable <> 2 THEN
    RAISE EXCEPTION 'DSR intake: expected both new columns NULLABLE, found % of 2 — a NOT NULL here would require backfilling what a data subject asked for', nullable;
  END IF;

  -- (3) AND NO CHECK CONSTRAINT MENTIONS EITHER COLUMN — the assertion BY ABSENCE, and the one that
  -- protects the fourteen open requests. A `NOT VALID` CHECK fires on UPDATE, so adding one here
  -- would make closing a pre-existing request impossible: a statutory deadline that cannot be met
  -- because of a column added afterwards.
  SELECT string_agg(conname, ', ') INTO constrained
  FROM pg_constraint
  WHERE conrelid = '"DataSubjectRequest"'::regclass
    AND contype = 'c'
    AND (pg_get_constraintdef(oid) LIKE '%requestText%'
         OR pg_get_constraintdef(oid) LIKE '%intakeChannel%');
  IF constrained IS NOT NULL THEN
    RAISE EXCEPTION 'DSR intake: % constrains one of the new columns. A CHECK fires on UPDATE, so it would refuse the CLOSURE of requests that predate these columns — read the note at the top of this migration', constrained;
  END IF;

  -- (4) AND REPORT WHAT PREDATES THIS, so the figure is in the log rather than re-derived later.
  -- Not an assertion: a database built from nothing legitimately has none, and a real deployment
  -- legitimately has some.
  SELECT count(*) INTO legacy
  FROM "DataSubjectRequest"
  WHERE "requestText" IS NULL OR "intakeChannel" IS NULL;
  RAISE NOTICE 'DSR intake: % pre-existing request(s) carry neither field — they read, list and close unchanged, and nothing backfills them', legacy;
END $$;
