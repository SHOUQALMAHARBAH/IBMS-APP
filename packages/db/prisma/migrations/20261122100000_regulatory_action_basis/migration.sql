-- MODULE 0-ب ITEM (d) — THE REGULATOR'S ACT HAS TO SAY WHICH PROVISION IT WAS TAKEN UNDER,
-- BECAUSE THE TWO SUSPENSIONS IN THESE INSTRUCTIONS ARE NOT THE SAME ACT.
--
-- ## WHAT WAS MEASURED, AND WHY IT CHANGES THE MODEL
--
-- The corrected field dictionary (13 October) records against the licence-status field:
--
--   «والإيقافُ الذي يتجاوز سنتين يُعدُّ إلغاءً حكماً (م١٤/ج) ويُحسَب»
--   — a suspension exceeding two years counts as a cancellation by operation of law, and is COMPUTED.
--
-- That citation was then verified against the scan rather than taken on trust, and reading art. 14
-- in full is what produced this migration. Printed page 16, art. (14) «وقف الترخيص»:
--
--   14/a  «يتم وقف ترخيص وسيط التأمين بناء على طلبه بموافقة مسبقة من البنك المركزي»
--         — the licence is suspended AT THE BROKER'S OWN REQUEST, with the Central Bank's prior
--           approval. A voluntary withdrawal, not a penalty.
--   14/b  the broker so suspended may apply in writing, on the CBJ's form, to be re-entered in the
--         register — which is what REINSTATEMENT names.
--   14/c  «في حال تجاوزت مدة وقف الترخيص سنتين يعتبر الترخيص ملغى حكماً، وعلى الوسيط تقديم طلب
--         ترخيص جديد» — beyond two years the licence is DEEMED CANCELLED and a NEW application is
--         required.
--
-- And printed page 26, art. 21/b — the CBJ's administrative sanctions — contains a DIFFERENT
-- suspension:
--
--   21/b/5 «وقف أو إلغاء ترخيص وسيط التأمين في جميع فروع التأمين المرخص له بممارسة أعماله فيها أو
--          بأي منها وللمدة التي يراها مناسبة»
--   21/b/6 the same for an office branch inside or outside the Kingdom.
--
-- So a suspension is either something the broker ASKED FOR (art. 14/a, open-ended, and art. 14/c
-- turns it into a cancellation after two years) or something the CBJ IMPOSED (art. 21/b, which
-- states its own period — «وللمدة التي يراها مناسبة»).
--
-- ## WHY A COLUMN RATHER THAN A CONVENTION
--
-- Without it the art. 14/c derivation has nothing to decide on, and both available behaviours are
-- wrong:
--
--   * apply 14/c to every suspension — and a brokerage serving a long CBJ sanction is reported
--     CANCELLED, by operation of a rule written for voluntary withdrawal. That is the system making
--     a false claim about an office's regulatory standing, in the direction that costs it its
--     licence on screen.
--   * apply it to none — and art. 14/c is not implemented, while the dictionary says it is computed.
--
-- Whether art. 14/c ALSO reaches an art. 21/b suspension is genuinely unsettled: 14/b scopes itself
-- to «الفقرة (أ) من هذه المادة» and 14/c carries no such phrase, so the text reads either way. It is
-- NOT resolved here by inference. A 21/b suspension states its own period, so the question only
-- arises for one that does not, and that case is recorded in docs/deferred-register.md as a question
-- for the regulator rather than guessed at. The lesson behind the restraint is correction 0.1 of
-- this very module: a rule asserted under an article that does not carry it is worse than the same
-- rule with no citation at all.
--
-- ## WHAT THIS DOES NOT EXPRESS, STATED RATHER THAN DISCOVERED
--
-- Art. 21/b/5 suspends or cancels «في جميع فروع التأمين ... أو بأي منها» — in ALL the insurance
-- lines or ANY OF THEM — and 21/b/6 does the same for an office branch. A PARTIAL sanction is
-- therefore representable in the regulation and NOT in this table: every act here is total.
--
-- The consequence has a direction and it is not the safe one. A partial suspension recorded as a
-- total one reports an office as unable to write business it is lawfully still licensed for — the
-- error runs AGAINST the brokerage, the same direction as the empty holiday calendar this repository
-- already records as a real defect. It is named in docs/deferred-register.md with that direction
-- stated, and nothing in this module claims the act model is complete.
--
-- RegulatoryAction holds ZERO rows on dev and db-test (measured, both databases), so `basis` is
-- added NOT NULL with no backfill and no default — the same call as Organization.type: neither value
-- is the safer one, so a default would silently decide which article an act was taken under.

CREATE TYPE "RegulatoryActionBasis" AS ENUM ('BROKER_REQUEST', 'SANCTION');

ALTER TABLE "RegulatoryAction"
  ADD COLUMN "basis" "RegulatoryActionBasis" NOT NULL,
  -- The period the CBJ set under art. 21/b, where it set one. NULL on an art. 14/a suspension, which
  -- is open-ended by nature — that openness is what art. 14/c counts. DERIVED FROM, never stored as,
  -- a status: a sanction whose period has run out stops suspending the office the moment the date
  -- passes, with nothing to sweep and nothing to go stale.
  ADD COLUMN "suspendedUntil" DATE;

-- A period belongs to a SUSPENSION. On a cancellation it is meaningless; on a reinstatement it would
-- read as "reinstated until", a sentence nobody should be able to write.
ALTER TABLE "RegulatoryAction"
  ADD CONSTRAINT "RegulatoryAction_until_only_on_suspension"
  CHECK ("suspendedUntil" IS NULL OR "kind" = 'SUSPENSION');

-- ============================================================================================
-- ASSERTIONS — run against the live database, in the migration, never asserted in prose.
-- ============================================================================================
DO $$
DECLARE
  n int;
  flag boolean;
  d text;
BEGIN
  -- (1) The composite tenant foreign keys are all still there. First assertion in every migration on
  --     this branch: a generated diff drops thirteen of them because Prisma cannot express them, and
  --     a migration quietly carrying those drops would let one office's row reference another
  --     office's parent with every test green.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) `basis` is NOT NULL and carries NO default. A default would decide, silently and forever,
  --     which article an act nobody classified was taken under.
  SELECT a.attnotnull INTO flag FROM pg_attribute a
   WHERE a.attrelid = '"RegulatoryAction"'::regclass AND a.attname = 'basis';
  IF flag IS NOT TRUE THEN
    RAISE EXCEPTION 'RegulatoryAction.basis is nullable — an act naming no provision cannot be derived from';
  END IF;
  SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO d
    FROM pg_attrdef ad JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
   WHERE a.attrelid = '"RegulatoryAction"'::regclass AND a.attname = 'basis';
  IF d IS NOT NULL THEN
    RAISE EXCEPTION 'RegulatoryAction.basis carries a DEFAULT (%) — the article an act was taken under is stated, never inherited', d;
  END IF;

  -- (3) EXACTLY the two values. A third added later changes what art. 14/c fires on, so it fails the
  --     build rather than arriving as a silent widening — the guard shape OrganizationType and
  --     BrokerKind have both already earned.
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO d
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'RegulatoryActionBasis';
  IF d IS DISTINCT FROM 'BROKER_REQUEST,SANCTION' THEN
    RAISE EXCEPTION 'RegulatoryActionBasis: expected exactly BROKER_REQUEST,SANCTION — found %', d;
  END IF;

  -- (4) The CHECK refuses a period on something that is not a suspension. PROVEN BY ATTEMPTING IT
  --     rather than by reading pg_constraint: a predicate loosened to `TRUE OR (...)` still names
  --     both columns and refuses nothing, which this module has already caught once.
  BEGIN
    INSERT INTO "RegulatoryAction"
      ("id","organizationId","kind","basis","effectiveFrom","decisionRef","recordedByUserId","suspendedUntil")
    SELECT '00000000-0000-4000-8000-0000000ra001', o.id, 'CANCELLATION', 'SANCTION',
           DATE '2026-01-01', 'PROBE', '00000000-0000-4000-8000-0000000ra002', DATE '2026-06-01'
      FROM "Organization" o LIMIT 1;
    RAISE EXCEPTION 'a CANCELLATION was accepted carrying suspendedUntil — the CHECK refuses nothing';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'RegulatoryAction: basis NOT NULL with no default, two labels, period restricted to a suspension';
END $$;
