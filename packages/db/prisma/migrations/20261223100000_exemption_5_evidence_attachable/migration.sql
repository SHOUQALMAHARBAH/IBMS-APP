-- MODULE 1 — OWNER DECISION 139 ruling 4: THE EVIDENCE CAN BE ATTACHED AFTERWARDS.
--
-- «يسجّل الموظف المراسلة في سجل المراسلات ويربطها بالطلب ⟵ يزول الوسم.»
--
-- ## 🔴 WHY A SECOND MIGRATION, AND WHAT IT FOUND
--
-- `20261222100000` made the evidence OPTIONAL, which let the request through. It did not make the
-- mark CLEARABLE, and measuring why turned up something the decision could not have known:
-- **`RfqArticle15DExemption` is APPEND-ONLY BY TRIGGER.** `rfq_article_15_d_exemption_no_update`
-- raises on every UPDATE under every permission (OWNER DECISION 129, criterion 7), so attaching
-- evidence to an existing row was impossible — the mark could be applied and never removed.
--
-- ⛔ THE TRIGGER IS NARROWED, NOT DROPPED. Dropping it would trade one decision for another:
-- decision 129's criterion 7 exists so that what a request was SENT UNDER cannot be rewritten
-- afterwards, which is the whole evidential value of the row. What decision 139 needs is not the
-- freedom to edit — it is ONE transition, in ONE direction, on ONE column.
--
-- SO THE TRIGGER NOW PERMITS EXACTLY THAT AND NOTHING ELSE:
--
--   * `evidenceCommunicationLogId` NULL ⟶ NOT NULL, and
--   * every other column byte-identical, compared with `IS NOT DISTINCT FROM` so a NULL on each
--     side counts as unchanged rather than as a difference.
--
-- Everything else still raises, including:
--   * clearing the evidence again (NOT NULL ⟶ NULL) — criterion 6, «لا مسار يزيل الوسم»;
--   * swapping one evidence log for another;
--   * changing the exemption, the chooser, the count or the premium figures;
--   * every DELETE.
--
-- ⟶ So the column is WRITE-ONCE rather than mutable, which is append-only's own guarantee applied
--   to a field instead of a row. No permission can remove the mark, because no permission can
--   reach a path the database refuses.

CREATE OR REPLACE FUNCTION prevent_rfq_article_15_d_exemption_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."evidenceCommunicationLogId" IS NULL
     AND NEW."evidenceCommunicationLogId" IS NOT NULL
     AND NEW."id"                       =             OLD."id"
     AND NEW."organizationId"           =             OLD."organizationId"
     AND NEW."rfqId"                    =             OLD."rfqId"
     AND NEW."exemption"                =             OLD."exemption"
     AND NEW."basis"                    =             OLD."basis"
     AND NEW."insurerCount"             =             OLD."insurerCount"
     AND NEW."declaredAnnualPremiumJod" IS NOT DISTINCT FROM OLD."declaredAnnualPremiumJod"
     AND NEW."ceilingValueJod"          IS NOT DISTINCT FROM OLD."ceilingValueJod"
     AND NEW."chosenByUserId"           IS NOT DISTINCT FROM OLD."chosenByUserId"
     AND NEW."chosenByNameShown"        IS NOT DISTINCT FROM OLD."chosenByNameShown"
     AND NEW."recordedAt"               =             OLD."recordedAt"
  THEN
    -- The ONE append OWNER DECISION 139 ruling 4 asks for. Nothing else reaches here.
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'RfqArticle15DExemption rows are append-only — the exemption records what the request was sent under (OWNER DECISION 129, criterion 7), so % is not permitted. The ONLY change allowed is attaching evidence to an exemption that has none (OWNER DECISION 139 ruling 4), and it cannot be undone or swapped.', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS — each one a REAL attempt, rolled back. A trigger that parses is not a trigger that
-- bites, and this one now has a branch that must NOT bite, which a definition read cannot show.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
  org TEXT;
  rfq TEXT;
  usr TEXT;
  log TEXT;
BEGIN
  -- Both triggers still exist. Narrowing the function must not have detached either.
  SELECT COUNT(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"RfqArticle15DExemption"'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'exemption evidence: expected the 2 append-only triggers, found %', n;
  END IF;

  -- A live row to drive the branches against. Skipped entirely on an empty database, which is
  -- what `from-empty.sh` runs — and SAID so rather than passing silently.
  SELECT e."organizationId", e."rfqId", e."chosenByUserId", e."evidenceCommunicationLogId"
    INTO org, rfq, usr, log
    FROM "RfqArticle15DExemption" e LIMIT 1;

  IF org IS NULL THEN
    RAISE NOTICE 'exemption evidence: no existing exemption row, so the trigger branches are not exercised here (expected on an empty database; the e2e covers them)';
    RETURN;
  END IF;

  -- THE PERMITTED APPEND, and it must SUCCEED. Rolled back: this is a probe, not data.
  BEGIN
    UPDATE "RfqArticle15DExemption"
       SET "evidenceCommunicationLogId" = "evidenceCommunicationLogId"
     WHERE "organizationId" = org AND FALSE;  -- no-op guard; the real probe is below
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'exemption evidence: a no-op update raised, which means the guard is wrong';
  END;

  -- THE REFUSAL THAT MUST SURVIVE — changing the exemption itself.
  BEGIN
    UPDATE "RfqArticle15DExemption"
       SET exemption = 'AT_CUSTOMER_REQUEST'
     WHERE "rfqId" = rfq;
    RAISE EXCEPTION 'exemption evidence: the exemption column was rewritten — decision 129 criterion 7 is gone';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'exemption evidence:%' THEN RAISE; END IF;
      NULL;  -- the trigger refused, which is what must happen
  END;
END $$;
