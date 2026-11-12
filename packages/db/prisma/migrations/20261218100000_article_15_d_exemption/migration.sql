-- MODULE 1 — ART. 15/d: THE EXEMPTION STORED WITH THE REQUEST, AND THE ALERT WHEN A QUOTE
-- COMES BACK ABOVE THE CEILING.
--
-- A quote request must reach three insurance companies or more. OWNER DECISION 130's first ruling:
-- the office sends to three or more BECAUSE THAT IS WHAT THE LAW SAYS, so fewer than three is the
-- exception. When it happens, the request either rests on one of art. 15/d's five exemptions —
-- stored here, which is the article's own «ما يثبت ذلك» — or on a `DeclaredAct`.
--
-- OWNER DECISION 129 is the whole subject of the `basis` column, and its criterion 7 is that the
-- record tells «وسمه النظام» from «اختاره فلان».
--
-- ## 🔴 `TAGGED_BY_SYSTEM` IS UNREACHABLE TODAY, AND THAT IS MEASURED RATHER THAN ASSUMED
--
-- Message 36 §4 rules that none of the five can be tagged by the system today, so every row this
-- migration will ever see (until a product decision changes it) is `CHOSEN_BY_PERSON`. Measured
-- 2026-11-12, per exemption:
--
--   1, 2  `InsuranceLine` has NO individual/group split — no column names one, and
--         `MEDICAL_HEALTH` is a single row. Both exemptions depend on that distinction.
--   2     and the CONSECUTIVE-RENEWAL COUNT is underivable: the chain
--         `Policy -> RenewalCase -> Opportunity` exists in the schema and is BROKEN AT ONE LINK,
--         `Opportunity.renewalCaseId`, which nothing in the application writes.
--   3     the defined-benefit tag has a home already — `DEFINED_BENEFIT_CONTRACT_LIST`, seeded
--         with its shape and NO value, because the Central Bank has issued no list.
--   4     the line and the premium are both known, but the article's own condition — «شريطة
--         الاعتماد على سياسات اكتتابية لثلاث شركات» — is not a fact the system holds.
--   5     the customer's request is not a fact until somebody records it.
--
-- The value is NOT deleted. The distinction belongs to the record, and a column that cannot
-- express "the system established this" could never record it when one of the five becomes
-- taggable. `docs/module-1-article-15-d.md` sizes each.
--
-- NO BACK-FILL: both tables are new and asserted EMPTY below. Not one of the 89 existing RFQs
-- gains an exemption, because nobody chose one for them — and inventing a choice on behalf of a
-- person is the one thing this record must never do.

CREATE TYPE "Article15DExemption" AS ENUM (
  'INDIVIDUAL_MEDICAL_RENEWAL',
  'GROUP_MEDICAL_RENEWAL_UP_TO_THREE_YEARS',
  'DEFINED_BENEFIT_CONTRACT',
  'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT',
  'AT_CUSTOMER_REQUEST'
);

CREATE TYPE "Article15DExemptionBasis" AS ENUM ('TAGGED_BY_SYSTEM', 'CHOSEN_BY_PERSON');

CREATE TABLE "RfqArticle15DExemption" (
  "id"                         TEXT NOT NULL,
  "organizationId"             TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  -- ONE exemption per request. The unique index is what makes "exactly one" true.
  "rfqId"                      TEXT NOT NULL,
  "exemption"                  "Article15DExemption" NOT NULL,
  "basis"                      "Article15DExemptionBasis" NOT NULL,
  -- How many insurers the request had reached when this was recorded. Decision 130's second
  -- ruling counts PER REQUEST.
  "insurerCount"               INTEGER NOT NULL,
  -- Exemption 4 only. MONEY, so Decimal — `money-decimal-jod.md`, and both are classified in
  -- `money-fields.inventory.ts`.
  "declaredAnnualPremiumJod"   DECIMAL(18,3),
  "ceilingValueJod"            DECIMAL(18,3),
  -- Exemption 5 only: an INBOUND `CommunicationLog` on this RFQ.
  "evidenceCommunicationLogId" TEXT,
  "chosenByUserId"             TEXT,
  "chosenByNameShown"          TEXT,
  "recordedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RfqArticle15DExemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RfqArticle15DExemption_rfqId_key" ON "RfqArticle15DExemption"("rfqId");
CREATE INDEX "RfqArticle15DExemption_organizationId_idx" ON "RfqArticle15DExemption"("organizationId");
CREATE INDEX "RfqArticle15DExemption_organizationId_exemption_idx" ON "RfqArticle15DExemption"("organizationId", "exemption");

-- Every FK RESTRICTS. An exemption is the evidence art. 15/d asks for; a cascade that removed it
-- when something upstream was deleted would destroy the evidence silently, which is the direction
-- `db:divergence` caught on `LegalValue`.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_rfqId_fkey"
  FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_evidenceCommunicationLogId_fkey"
  FOREIGN KEY ("evidenceCommunicationLogId") REFERENCES "CommunicationLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_chosenByUserId_fkey"
  FOREIGN KEY ("chosenByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE CHECKS. Decision 129's rules where a caller cannot forget them.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- CRITERION 7, THE FIRST HALF. `basis` and the person are tied in BOTH directions, so the record
-- can never say "a person chose this" without saying WHICH person, nor "the system tagged it"
-- while naming one. A nullable pair with no constraint is how a record ends up half-attributed.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_basis_names_its_chooser"
  CHECK (
    ("basis" = 'CHOSEN_BY_PERSON'
      AND "chosenByUserId" IS NOT NULL
      AND "chosenByNameShown" IS NOT NULL AND btrim("chosenByNameShown") <> '')
    OR ("basis" = 'TAGGED_BY_SYSTEM'
      AND "chosenByUserId" IS NULL
      AND "chosenByNameShown" IS NULL)
  );

-- EXEMPTION 4 CARRIES ITS TWO FIGURES AND NO OTHER EXEMPTION DOES. A premium on exemption 1 would
-- be a number nobody can interpret; a missing ceiling on exemption 4 would make criterion 4
-- unanswerable, because the request would no longer carry the value it was sent under.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_premium_figures_match_the_exemption"
  CHECK (
    ("exemption" = 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT'
      AND "declaredAnnualPremiumJod" IS NOT NULL AND "ceilingValueJod" IS NOT NULL)
    OR ("exemption" <> 'LOW_PREMIUM_MOTOR_MEDICAL_OR_TRANSIT'
      AND "declaredAnnualPremiumJod" IS NULL AND "ceilingValueJod" IS NULL)
  );

-- DECISION 129's CRITERION 3, AT THE DATABASE. «قسط ٢٠٠١ في المركبات ⟶ الإعفاء الرابع لا يُعرَض»
-- — a premium above the ceiling means the exemption does not apply, so a row recording one cannot
-- exist. The service refuses it first with a message naming the figures; this is the second
-- defence, for a path that does not go through the service.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_declared_premium_is_within_the_ceiling"
  CHECK (
    "declaredAnnualPremiumJod" IS NULL
    OR "declaredAnnualPremiumJod" <= "ceilingValueJod"
  );

-- Money is never negative here. A negative premium or ceiling is not a smaller number, it is a
-- different kind of fact.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_money_is_not_negative"
  CHECK (
    ("declaredAnnualPremiumJod" IS NULL OR "declaredAnnualPremiumJod" >= 0)
    AND ("ceilingValueJod" IS NULL OR "ceilingValueJod" >= 0)
  );

-- EXEMPTION 5 IS NOT STORED WITHOUT EVIDENCE — decision 129's criterion 5, «الإعفاء الخامس بلا ما
-- يثبت طلب العميل ⟶ لا يُحفَظ». The FK makes the evidence real; this makes it MANDATORY for that
-- exemption and forbidden for the others, so the column cannot become a loose attachment point.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_customer_request_carries_its_evidence"
  CHECK (
    ("exemption" = 'AT_CUSTOMER_REQUEST' AND "evidenceCommunicationLogId" IS NOT NULL)
    OR ("exemption" <> 'AT_CUSTOMER_REQUEST' AND "evidenceCommunicationLogId" IS NULL)
  );

-- AN EXEMPTION ONLY EXISTS BECAUSE THE REQUEST REACHED FEWER THAN THREE. A row recording three or
-- more would be an exemption from a rule that was already satisfied — nothing to be exempt from —
-- and would quietly inflate the share of requests that "needed" one.
ALTER TABLE "RfqArticle15DExemption"
  ADD CONSTRAINT "RfqArticle15DExemption_only_below_three_insurers"
  CHECK ("insurerCount" >= 0 AND "insurerCount" < 3);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE ALERT. Raised LATER, when a quotation comes back above the ceiling.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "Article15DPremiumAlert" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "exemptionId"      TEXT NOT NULL,
  "quotationId"      TEXT NOT NULL,
  "quotedPremiumJod" DECIMAL(18,3) NOT NULL,
  "ceilingValueJod"  DECIMAL(18,3) NOT NULL,
  "raisedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Article15DPremiumAlert_pkey" PRIMARY KEY ("id")
);

-- ONE alert per (exemption, quotation). A second quotation on the same RFQ that also exceeds the
-- ceiling is its OWN alert — which is why this is not a flag on the exemption — but the same
-- quotation must not raise two.
CREATE UNIQUE INDEX "Article15DPremiumAlert_exemptionId_quotationId_key"
  ON "Article15DPremiumAlert"("exemptionId", "quotationId");
CREATE INDEX "Article15DPremiumAlert_organizationId_idx" ON "Article15DPremiumAlert"("organizationId");

ALTER TABLE "Article15DPremiumAlert"
  ADD CONSTRAINT "Article15DPremiumAlert_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article15DPremiumAlert"
  ADD CONSTRAINT "Article15DPremiumAlert_exemptionId_fkey"
  FOREIGN KEY ("exemptionId") REFERENCES "RfqArticle15DExemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Article15DPremiumAlert"
  ADD CONSTRAINT "Article15DPremiumAlert_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AN ALERT THAT IS NOT ABOVE THE CEILING IS NOT AN ALERT. Without this a sweep could write rows
-- for every quotation and the register would read as a wall of warnings, which is how a real one
-- stops being noticed.
ALTER TABLE "Article15DPremiumAlert"
  ADD CONSTRAINT "Article15DPremiumAlert_is_actually_above_the_ceiling"
  CHECK ("quotedPremiumJod" > "ceilingValueJod");

ALTER TABLE "Article15DPremiumAlert"
  ADD CONSTRAINT "Article15DPremiumAlert_money_is_not_negative"
  CHECK ("quotedPremiumJod" >= 0 AND "ceilingValueJod" >= 0);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY, ENABLED **AND FORCED** on both. One office's exemptions and alerts are its
-- own regulatory evidence. FORCE because `ENABLE` alone exempts the table's owner, and neither of
-- these tables is ever written by the seed, so nothing legitimate needs that exemption.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "RfqArticle15DExemption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RfqArticle15DExemption" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RfqArticle15DExemption_tenant_isolation" ON "RfqArticle15DExemption"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "Article15DPremiumAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Article15DPremiumAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Article15DPremiumAlert_tenant_isolation" ON "Article15DPremiumAlert"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CRITERION 7's SECOND HALF — «ولا يُعدَّل بعد الإرسال». The exemption is append-only.
--
-- An exemption that can be swapped after the request was sent is not evidence of anything: the
-- whole value of the row is that it records what was relied on AT THE TIME. The ALERT table has no
-- such trigger, deliberately — it is only ever inserted, and giving it one would suggest something
-- updates it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION prevent_rfq_article_15_d_exemption_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'RfqArticle15DExemption rows are append-only — the exemption records what the request was sent under, so % is not permitted (OWNER DECISION 129, criterion 7)', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER rfq_article_15_d_exemption_no_update
  BEFORE UPDATE ON "RfqArticle15DExemption"
  FOR EACH ROW EXECUTE FUNCTION prevent_rfq_article_15_d_exemption_mutation();

CREATE TRIGGER rfq_article_15_d_exemption_no_delete
  BEFORE DELETE ON "RfqArticle15DExemption"
  FOR EACH ROW EXECUTE FUNCTION prevent_rfq_article_15_d_exemption_mutation();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  SELECT count(*) INTO n FROM "RfqArticle15DExemption";
  IF n <> 0 THEN
    RAISE EXCEPTION 'art. 15/d: expected an empty exemption table, found % row(s) — something back-filled a choice nobody made', n;
  END IF;

  SELECT count(*) INTO n FROM "Article15DPremiumAlert";
  IF n <> 0 THEN
    RAISE EXCEPTION 'art. 15/d: expected an empty alert table, found % row(s)', n;
  END IF;

  -- The instrument lists FIVE exemptions. A sixth would mean somebody read the article differently.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'Article15DExemption';
  IF n <> 5 THEN
    RAISE EXCEPTION 'art. 15/d: Article15DExemption holds % members, expected the article''s five', n;
  END IF;

  -- BOTH bases exist even though only one is reachable today. Deleting `TAGGED_BY_SYSTEM` would
  -- make decision 129's criterion 7 unrecordable the day an exemption becomes taggable.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'Article15DExemptionBasis';
  IF n <> 2 THEN
    RAISE EXCEPTION 'art. 15/d: Article15DExemptionBasis holds % members, expected 2 — TAGGED_BY_SYSTEM is unreachable today and must not be removed', n;
  END IF;

  -- RLS enabled AND forced on both.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname IN ('RfqArticle15DExemption', 'Article15DPremiumAlert')
     AND relrowsecurity AND relforcerowsecurity;
  IF n <> 2 THEN
    RAISE EXCEPTION 'art. 15/d: row-level security is not both ENABLED and FORCED on both tables (% of 2)', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename IN ('RfqArticle15DExemption', 'Article15DPremiumAlert');
  IF n <> 2 THEN
    RAISE EXCEPTION 'art. 15/d: expected one tenant policy per table, found %', n;
  END IF;

  -- The exemption is append-only; the alert is deliberately NOT.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"RfqArticle15DExemption"'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'art. 15/d: expected 2 append-only triggers on the exemption, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"Article15DPremiumAlert"'::regclass AND NOT tgisinternal;
  IF n <> 0 THEN
    RAISE EXCEPTION 'art. 15/d: the ALERT table has % non-internal trigger(s) and should have none — it is insert-only by use, not by refusal', n;
  END IF;

  -- The six CHECKs on the exemption and the two on the alert.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"RfqArticle15DExemption"'::regclass AND contype = 'c';
  IF n <> 6 THEN
    RAISE EXCEPTION 'art. 15/d: expected 6 CHECK constraints on the exemption, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"Article15DPremiumAlert"'::regclass AND contype = 'c';
  IF n <> 2 THEN
    RAISE EXCEPTION 'art. 15/d: expected 2 CHECK constraints on the alert, found %', n;
  END IF;

  -- Every foreign key RESTRICTS. Four on the exemption, three on the alert.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid IN ('"RfqArticle15DExemption"'::regclass, '"Article15DPremiumAlert"'::regclass)
     AND contype = 'f' AND confdeltype <> 'r';
  IF n <> 0 THEN
    RAISE EXCEPTION 'art. 15/d: % foreign key(s) do not RESTRICT on delete — a cascade here would remove the evidence the article asks for', n;
  END IF;
END $$;
