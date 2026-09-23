-- The four MUST models stop filing business by a string somebody typed.
--
-- `InsuranceProgramLine`, `RFQ`, `Policy`, `CommissionAgreement` — the four where a line must
-- MATCH another model's line for the system to work at all: a programme line becomes an RFQ,
-- an RFQ becomes a Policy, and a CommissionAgreement is applied to a Policy by line. Four
-- independently-typed strings cannot be matched; four FKs to one catalogue can.
--
-- `InsurerProduct` is deliberately NOT in this migration — see the note at the end.
--
-- ============================================================================
-- THE RULE THIS FOLLOWS (IMPROVEMENTS.md § 1.26), AND WHY IT IS NOT A BACKFILL
-- ============================================================================
--
-- 1. Every row either MAPS to a line id, or is explicitly PARKED — its original string retained
--    and counted. Nothing is silently dropped.
-- 2. Nothing is funnelled into an "Unclassified" line. An unclassified line is a line nobody
--    writes, and it would poison the directory this conversion exists to serve.
-- 3. `insuranceLine` (the string) STAYS. It drops in a later migration, and only when a test
--    MEASURES zero unmapped rows — not when we believe there are none.
--
-- Both FKs on every model, exactly one set, because all four are OFFICE-SCOPED: an office may
-- legitimately reference a line it added itself. That is the opposite of `InsurerFormTemplate`
-- (global, so global-catalogue only). The rule: a row every office READS may only point at things
-- every office may SEE — and these rows are read by one office.
--
-- ============================================================================
-- THE MAPPING, DERIVED FROM THE DATA RATHER THAN IMAGINED
-- ============================================================================
--
-- Measured across both databases before writing this (dev is demo-shaped, db-test is cumulative
-- fixture noise — 5,626 Policy rows over 184 distinct values):
--
--   MAPPED CLEANLY          "Property All Risks" 4,367 · "property" 627 · "Burglary" · "Cyber"
--                           "Business Interruption" · "Machinery Breakdown" · "Product Liability"
--                           "Professional Indemnity" · "Public Liability" · "Group Life"
--                           "Individual Life" · "Motor Comprehensive" · "Motor Third Party"
--                           "Marine Cargo / Goods in Transit" · "Workers Comp(ensation)"
--
--   MAPPED, VARIANT PENDING "Motor Fleet" · "Group Medical" · "Individual Medical"
--                           "Property All Risks (Fire)"
--                           The 32 cannot express fleet-vs-individual or a named sub-peril. These
--                           map to the correct LINE now; the distinction lives on in the retained
--                           string and becomes a `variant` in the next commit (§ 1.25). Mapping
--                           the line is not lossy while the string is still there — which is the
--                           whole reason rule 3 above exists.
--
--   PARKED, DELIBERATELY    "motor" / "Motor" (393 rows) — ambiguous between MOTOR_TPL_COMPULSORY
--                           and MOTOR_COMPREHENSIVE, which are different products at different
--                           premiums. Guessing here would silently reprice business.
--                           "portfolio-e2e-line-<timestamp>-<random>" (180 values, 239 rows) and
--                           "any thing" (1) — fixture noise and a typo. Unmappable by
--                           construction, and exactly what an unconstrained column attracts.
--
-- Two values the audit flagged as needing a HUMAN decision — "Fire & Property" and
-- "General/Product Liability", each spanning two of the 32 — appear only in `InsurerProduct`,
-- which this migration does not touch. They are corrected AT THE SOURCE in the seed rather than
-- interpreted here: every row in every database is synthetic, so building machinery to interpret
-- fiction is the tidiness being avoided.

-- ---------------------------------------------------------------------------
-- 1. The columns and their constraints.
-- ---------------------------------------------------------------------------
ALTER TABLE "InsuranceProgramLine" ADD COLUMN "insuranceLineId" TEXT, ADD COLUMN "officeInsuranceLineId" TEXT;
ALTER TABLE "RFQ"                  ADD COLUMN "insuranceLineId" TEXT, ADD COLUMN "officeInsuranceLineId" TEXT;
ALTER TABLE "Policy"               ADD COLUMN "insuranceLineId" TEXT, ADD COLUMN "officeInsuranceLineId" TEXT;
ALTER TABLE "CommissionAgreement"  ADD COLUMN "insuranceLineId" TEXT, ADD COLUMN "officeInsuranceLineId" TEXT;

-- Plain FK to the GLOBAL catalogue: no tenancy to agree about, since `InsuranceLine` is global
-- and read-only. RESTRICT so a line cannot be removed from under business that references it.
ALTER TABLE "InsuranceProgramLine" ADD CONSTRAINT "InsuranceProgramLine_insuranceLineId_fkey" FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RFQ"                  ADD CONSTRAINT "RFQ_insuranceLineId_fkey"                  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Policy"               ADD CONSTRAINT "Policy_insuranceLineId_fkey"               FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionAgreement"  ADD CONSTRAINT "CommissionAgreement_insuranceLineId_fkey"  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- COMPOSITE FK to the office catalogue, `(officeInsuranceLineId, organizationId)` ->
-- `OfficeInsuranceLine(id, organizationId)`. Not decoration: without it, office A's row could
-- reference office B's private line and the reference would be structurally valid. With it, a row
-- that disagrees with its parent about which office it belongs to FAILS TO INSERT — the same
-- guarantee `InsurerOfferedLine` already has, for the same reason. Raw SQL because Prisma cannot
-- express it without pulling `organizationId` into the relation and changing the generated
-- client's shape for four models the whole codebase reads.
ALTER TABLE "InsuranceProgramLine" ADD CONSTRAINT "InsuranceProgramLine_office_line_same_org_fkey" FOREIGN KEY ("officeInsuranceLineId", "organizationId") REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RFQ"                  ADD CONSTRAINT "RFQ_office_line_same_org_fkey"                  FOREIGN KEY ("officeInsuranceLineId", "organizationId") REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Policy"               ADD CONSTRAINT "Policy_office_line_same_org_fkey"               FOREIGN KEY ("officeInsuranceLineId", "organizationId") REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionAgreement"  ADD CONSTRAINT "CommissionAgreement_office_line_same_org_fkey"  FOREIGN KEY ("officeInsuranceLineId", "organizationId") REFERENCES "OfficeInsuranceLine"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most ONE of the two. Both set is a row claiming two different lines; the application would
-- then have to pick, and whichever it picked would be right half the time.
ALTER TABLE "InsuranceProgramLine" ADD CONSTRAINT "InsuranceProgramLine_line_exactly_one" CHECK (num_nonnulls("insuranceLineId", "officeInsuranceLineId") <= 1);
ALTER TABLE "RFQ"                  ADD CONSTRAINT "RFQ_line_exactly_one"                  CHECK (num_nonnulls("insuranceLineId", "officeInsuranceLineId") <= 1);
ALTER TABLE "Policy"               ADD CONSTRAINT "Policy_line_exactly_one"               CHECK (num_nonnulls("insuranceLineId", "officeInsuranceLineId") <= 1);
ALTER TABLE "CommissionAgreement"  ADD CONSTRAINT "CommissionAgreement_line_exactly_one"  CHECK (num_nonnulls("insuranceLineId", "officeInsuranceLineId") <= 1);

CREATE INDEX "InsuranceProgramLine_insuranceLineId_idx" ON "InsuranceProgramLine" ("insuranceLineId");
CREATE INDEX "RFQ_insuranceLineId_idx"                  ON "RFQ" ("insuranceLineId");
CREATE INDEX "Policy_insuranceLineId_idx"               ON "Policy" ("insuranceLineId");
CREATE INDEX "CommissionAgreement_insuranceLineId_idx"  ON "CommissionAgreement" ("insuranceLineId");

-- ---------------------------------------------------------------------------
-- 2. The mapping, applied to all four from one table.
-- ---------------------------------------------------------------------------
-- One temporary table rather than four copies of the same CASE expression: a mapping that appears
-- four times is a mapping that diverges in three places. Matched case-insensitively on the trimmed
-- string, because "property" and "Property All Risks" are the same intent typed by two people.
CREATE TEMP TABLE line_mapping (observed text PRIMARY KEY, code text NOT NULL) ON COMMIT DROP;
INSERT INTO line_mapping (observed, code) VALUES
  ('property all risks',               'PROPERTY_ALL_RISKS'),
  ('property',                         'PROPERTY_ALL_RISKS'),
  ('property all risks (fire)',        'PROPERTY_ALL_RISKS'),          -- variant 'fire' pending
  ('business interruption',            'BUSINESS_INTERRUPTION'),
  ('burglary',                         'BURGLARY_THEFT'),
  ('cyber',                            'CYBER'),
  ('machinery breakdown',              'ENGINEERING_MACHINERY_BREAKDOWN'),
  ('product liability',                'PRODUCT_LIABILITY'),
  ('professional indemnity',           'PROFESSIONAL_INDEMNITY'),
  ('public liability',                 'PUBLIC_GENERAL_LIABILITY'),
  ('workers comp',                     'WORKMEN_COMPENSATION_EMPLOYER_LIABILITY'),
  ('workers compensation',             'WORKMEN_COMPENSATION_EMPLOYER_LIABILITY'),
  ('marine cargo / goods in transit',  'MARINE_CARGO'),
  ('marine cargo',                     'MARINE_CARGO'),
  ('group life',                       'LIFE_GROUP'),                 -- a real line, not a variant
  ('individual life',                  'LIFE_INDIVIDUAL'),
  ('group medical',                    'MEDICAL_HEALTH'),             -- variant 'group' pending
  ('individual medical',               'MEDICAL_HEALTH'),             -- variant 'individual' pending
  ('motor comprehensive',              'MOTOR_COMPREHENSIVE'),
  ('motor fleet',                      'MOTOR_COMPREHENSIVE'),        -- variant 'fleet' pending
  ('motor third party',                'MOTOR_TPL_COMPULSORY');
-- Deliberately ABSENT, so they park: 'motor' / 'Motor' (ambiguous between the two motor lines),
-- 'portfolio-e2e-line-*', 'any thing', 'Fire & Property', 'General/Product Liability'.

UPDATE "InsuranceProgramLine" t SET "insuranceLineId" = l.id
  FROM line_mapping m JOIN "InsuranceLine" l ON l.code = m.code
 WHERE lower(btrim(t."insuranceLine")) = m.observed;
UPDATE "RFQ" t SET "insuranceLineId" = l.id
  FROM line_mapping m JOIN "InsuranceLine" l ON l.code = m.code
 WHERE lower(btrim(t."insuranceLine")) = m.observed;
UPDATE "Policy" t SET "insuranceLineId" = l.id
  FROM line_mapping m JOIN "InsuranceLine" l ON l.code = m.code
 WHERE lower(btrim(t."insuranceLine")) = m.observed;
UPDATE "CommissionAgreement" t SET "insuranceLineId" = l.id
  FROM line_mapping m JOIN "InsuranceLine" l ON l.code = m.code
 WHERE lower(btrim(t."insuranceLine")) = m.observed;

-- ---------------------------------------------------------------------------
-- 3. REPORT what parked, and assert the rule rather than the outcome.
-- ---------------------------------------------------------------------------
-- The assertion is NOT "nothing parked" — parking is legal and expected here, and a migration that
-- demanded zero would have to invent a mapping for 'any thing'. What is asserted is that parking
-- is VISIBLE: the count and the distinct strings are raised as a NOTICE, so an operator applying
-- this to a real database sees exactly what was left behind instead of discovering it later.
DO $report$
DECLARE
  r        record;
  parked   bigint := 0;
  detail   text;
BEGIN
  FOR r IN
    SELECT 'InsuranceProgramLine' AS tbl UNION ALL SELECT 'RFQ'
    UNION ALL SELECT 'Policy' UNION ALL SELECT 'CommissionAgreement'
  LOOP
    EXECUTE format(
      'SELECT count(*), coalesce(string_agg(DISTINCT quote_literal("insuranceLine"), '', ''), ''-'') FROM %I WHERE "insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NULL',
      r.tbl
    ) INTO parked, detail;
    IF parked > 0 THEN
      RAISE NOTICE 'PARKED in %: % row(s), original strings retained: %', r.tbl, parked, detail;
    ELSE
      RAISE NOTICE 'PARKED in %: none — every row mapped.', r.tbl;
    END IF;
  END LOOP;

  -- What IS asserted: no row got both, and no mapped row points at a line that does not exist.
  -- The CHECK constraints above already guarantee the first; this catches a mapping that wrote an
  -- id the catalogue does not have, which the FK would also catch — belt and braces, because this
  -- block is the last thing to run and the cheapest place to be sure.
  FOR r IN
    SELECT 'InsuranceProgramLine' AS tbl UNION ALL SELECT 'RFQ'
    UNION ALL SELECT 'Policy' UNION ALL SELECT 'CommissionAgreement'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I t WHERE t."insuranceLineId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InsuranceLine" l WHERE l.id = t."insuranceLineId")',
      r.tbl
    ) INTO parked;
    IF parked > 0 THEN
      RAISE EXCEPTION '% has % row(s) whose insuranceLineId is not in the catalogue. The mapping wrote an id that does not exist.', r.tbl, parked;
    END IF;
  END LOOP;
END
$report$;

-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- * It does NOT drop `insuranceLine`. That is rule 3, and the drop is a later migration gated on a
--   test measuring zero unmapped rows. Until then the string is the record of what parked.
-- * It does NOT make the FK required. A required FK plus parked rows is a migration that cannot
--   apply, which would force the guessing this avoids.
-- * It does NOT touch `InsurerProduct`, whose line is also free text. That model has no live
--   consumer and no matching requirement — nothing compares its line to another model's — so it
--   has no reason to convert yet. **The condition on that, stated as future work rather than a
--   present-tense claim: the moment anything reads `InsurerProduct.insuranceLine` to match a
--   Policy, an RFQ or a CommissionAgreement, it converts in that commit.** Its two ambiguous
--   values ("Fire & Property", "General/Product Liability") are corrected in the seed at that
--   point, not interpreted by a mapping table.
-- * It adds no `variant`. The four values needing one map to the correct LINE and keep their
--   original string, which is where the distinction lives until § 1.25's variant axis lands next.
