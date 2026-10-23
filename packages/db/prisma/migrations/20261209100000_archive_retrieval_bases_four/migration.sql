-- Owner decision 45 — THE RETRIEVAL BASES ARE FOUR, AND EACH ONE EXPLAINS ITSELF.
--
-- `RetentionArchiveRetrievalBasis` shipped with two members because two were all that had been
-- decided. The office meets more than two kinds of lawful compulsion, and the two that were missing
-- are not edge cases: a request from the anti-money-laundering unit is a routine fact of a licensed
-- broker's year, and everything else legitimate had nowhere to go at all.
--
-- WHY `AMLU_REQUEST` IS ITS OWN BASIS AND NOT AN EXAMPLE UNDER `OTHER` — OWNER DECISION, RECORDED SO
-- IT IS NOT "TIDIED" LATER. The unit is a named statutory counterparty under AML/CTF Law No. 20 of
-- 2021, the same standing the Central Bank has in `CBJ_AUDIT`; folding it into the free-text basis
-- would make the one register that answers *why did this file leave the archive, and for whom* unable
-- to say how many times the AMLU asked, without reading every note by hand.
--
-- AND `OTHER` IS NOT A HOLE IN THE CLOSED LIST. The `note` column is already NOT NULL and already
-- carries the `common/declaration-reason.ts` floor, for EVERY basis — so "OTHER is not accepted
-- without an explanation" was already true before this migration and needed nothing built. A
-- conditional requirement keyed on the basis would be a second mechanism for a rule the column
-- already enforces unconditionally, which is what this codebase refuses. The closed list still does
-- its job: free text may ACCOMPANY a basis and may never BE one — `OTHER` is a DECLARED kind of
-- compulsion ("legitimate, and none of the three above"), not an escape from declaring one.
--
-- NO DATA MIGRATION. Old rows keep the basis they were recorded under; neither new value is a
-- re-reading of an old one, so there is nothing to move and moving anything would rewrite the
-- office's own answer about a retrieval that already happened.
--
-- NOTHING BRANCHES ON A BASIS, which is what makes this a one-statement change rather than a sweep.
-- Measured across both apps: the only occurrences are the list declaration itself, a label LOOKUP
-- keyed by member, tests and comments. The second copy of the vocabulary and the ternary that
-- decided the label from one member were both removed on 2026-10-23 — that ternary rendered the
-- Central Bank label for any basis other than `JUDICIAL_REQUEST`, so adding a third member BEFORE
-- that fix would have recorded an AMLU request on screen as an audit that never happened.
ALTER TYPE "RetentionArchiveRetrievalBasis" ADD VALUE 'AMLU_REQUEST';
ALTER TYPE "RetentionArchiveRetrievalBasis" ADD VALUE 'OTHER';

DO $$
DECLARE
  labels TEXT;
BEGIN
  -- The EXACT member set, in sort order, not a count: a count of four is satisfied by a typo that
  -- added `AMLU_REQUST` and dropped nothing, and the DTO's `@IsIn` would then refuse every request
  -- the register exists to record. `enumsortorder` is what the api's own list order must match.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    INTO labels
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'RetentionArchiveRetrievalBasis';

  IF labels IS DISTINCT FROM 'JUDICIAL_REQUEST,CBJ_AUDIT,AMLU_REQUEST,OTHER' THEN
    RAISE EXCEPTION 'decision 45: expected exactly JUDICIAL_REQUEST,CBJ_AUDIT,AMLU_REQUEST,OTHER in that order — found %', labels;
  END IF;
END $$;

DO $$
DECLARE
  nullable_note BOOLEAN;
BEGIN
  -- THE CLAIM THIS MIGRATION RESTS ON, ASSERTED RATHER THAN BELIEVED. The reason `OTHER` needs no
  -- conditional "explain yourself" rule is that `note` is NOT NULL for every basis. If that ever
  -- stops being true, `OTHER` becomes a basis a person can select and say nothing about — which is
  -- the free-text-as-a-basis failure the closed list exists to prevent, arriving through the column
  -- instead of through the list. So the premise fails the migration rather than the feature.
  SELECT a.attnotnull = FALSE
    INTO nullable_note
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = 'RetentionArchiveRetrieval'
     AND a.attname = 'note'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF nullable_note IS NULL THEN
    RAISE EXCEPTION 'decision 45: RetentionArchiveRetrieval.note not found — the premise that OTHER needs no conditional rule cannot be checked';
  END IF;
  IF nullable_note THEN
    RAISE EXCEPTION 'decision 45: RetentionArchiveRetrieval.note is NULLABLE — OTHER would be selectable with no explanation, so the closed list no longer holds';
  END IF;
END $$;
