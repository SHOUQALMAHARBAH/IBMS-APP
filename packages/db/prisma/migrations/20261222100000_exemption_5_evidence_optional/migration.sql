-- MODULE 1 — OWNER DECISION 139: THE FIFTH EXEMPTION PROCEEDS WITHOUT EVIDENCE, MARKED.
--
-- «الموظف الذي يختار الإعفاء الخامس («بناءً على طلب العميل») ولا يجد مراسلة مسجَّلة يكمل طلبه،
-- والإعفاء يبقى موسوماً «بلا إثبات» ظاهراً حتى يُرفِق مراسلة واردة من العميل بوسيلة تبليغ معتمدة.»
--
-- ## WHAT THIS CHANGES, AND IT CHANGES A DECISION
--
-- OWNER DECISION 129's fifth criterion made the server REFUSE art. 15/d/5 with no logged
-- communication, and this migration is her reversing that half — knowingly, and with the reason
-- in decision 139 §4: an act is only blocked when the harm is irreversible AND falls on somebody
-- other than the office. Here the harm falls on the office and is repaired by attaching the
-- message. Refusing at the last step was a punishment for forgetting to log a phone call.
--
-- ## THE CHECK LOSES ONE HALF AND KEEPS THE OTHER, WHICH IS THE WHOLE POINT
--
--   WAS:  (exemption =  AT_CUSTOMER_REQUEST AND evidence IS NOT NULL)
--      OR (exemption <> AT_CUSTOMER_REQUEST AND evidence IS     NULL)
--
--   NOW:  evidence IS NULL OR exemption = AT_CUSTOMER_REQUEST
--
-- ⟶ The half that is DROPPED is «the fifth exemption must carry evidence». The half that is KEPT
--   is «no OTHER exemption may carry any» — and that one is load-bearing: evidence of a
--   customer's request means nothing attached to a low-premium motor exemption, and a row
--   carrying one would be a fact nobody can interpret, which is the same argument the premium
--   columns' own CHECK makes one constraint up.
--
-- ⛔ AND THE MARK IS NOT A COLUMN. «موسوم بلا إثبات» is DERIVED — `exemption = AT_CUSTOMER_REQUEST
-- AND evidenceCommunicationLogId IS NULL` — because a stored flag would be a second home for a
-- fact this row already answers, and the two could disagree the moment evidence is attached. The
-- derivation has one home in `article-15-d.config.ts`.

ALTER TABLE "RfqArticle15DExemption"
  DROP CONSTRAINT "RfqArticle15DExemption_customer_request_carries_its_evidence";

ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_only_customer_request_carries_evidence"
  CHECK (
    "evidenceCommunicationLogId" IS NULL
    OR exemption = 'AT_CUSTOMER_REQUEST'::"Article15DExemption"
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS. The migration proves what it just built.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- 1. The old constraint is gone and the new one is here, BY NAME. A count would be satisfied
  --    by any two constraints, including the pair that would exist if the drop had failed.
  SELECT COUNT(*) INTO n FROM pg_constraint
   WHERE conrelid = '"RfqArticle15DExemption"'::regclass
     AND conname = 'RfqArticle15DExemption_customer_request_carries_its_evidence';
  IF n <> 0 THEN
    RAISE EXCEPTION 'exemption 5: the mandatory-evidence CHECK is still present';
  END IF;

  SELECT COUNT(*) INTO n FROM pg_constraint
   WHERE conrelid = '"RfqArticle15DExemption"'::regclass
     AND conname = 'RfqArticle15DExemption_only_customer_request_carries_evidence';
  IF n <> 1 THEN
    RAISE EXCEPTION 'exemption 5: the replacement CHECK is missing';
  END IF;

  -- 2. AND THE HALF THAT WAS KEPT IS STILL ENFORCED. Asserted as a real refusal rather than by
  --    reading the definition: a constraint that parses is not a constraint that bites. The probe
  --    runs in a savepoint and is rolled back, so no row survives it.
  BEGIN
    INSERT INTO "RfqArticle15DExemption"
      ("id", "organizationId", "rfqId", "exemption", "basis", "insurerCount",
       "evidenceCommunicationLogId", "chosenByUserId", "chosenByNameShown")
    VALUES
      ('d139-probe', 'd139-org', 'd139-rfq', 'INDIVIDUAL_MEDICAL_RENEWAL',
       'CHOSEN_BY_PERSON', 1, 'd139-log', 'd139-user', 'probe');
    RAISE EXCEPTION 'exemption 5: a NON-customer-request exemption accepted evidence — the half of the CHECK that had to survive is gone';
  EXCEPTION
    WHEN check_violation THEN
      NULL;  -- what must happen
    WHEN foreign_key_violation THEN
      -- The CHECK is evaluated before the FKs on an empty database, so reaching here would mean
      -- the CHECK passed. Reported rather than swallowed.
      RAISE EXCEPTION 'exemption 5: the evidence CHECK did not fire — a foreign key refused first, so the constraint was never tested';
  END;

  -- 3. NOTHING IS BACK-FILLED. Every exemption-5 row written before today carries its evidence,
  --    because the old CHECK required it; the mark is for rows written from now on.
  SELECT COUNT(*) INTO n FROM "RfqArticle15DExemption"
   WHERE exemption = 'AT_CUSTOMER_REQUEST' AND "evidenceCommunicationLogId" IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'exemption 5: % pre-existing row(s) are already unmarked-without-evidence, which this migration cannot have created', n;
  END IF;
END $$;
