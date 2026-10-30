-- MODULE 0-ب CLOSE — EVERY VALUE A PERSON CHOOSES CARRIES AN ARABIC DESCRIPTION.
--
-- Two halves of one owner decision:
--
--   1. FOUR DESCRIPTION TABLES, one beside each enum, for the eleven members that had nowhere to
--      put a description. Her decision, over the cheaper i18n route: twenty-two translation keys
--      that nothing renders is the shape the enforcement inventory exists to refuse, and she would
--      rather pay once than reopen it two modules from now. Register entry 39 records the three
--      candidate homes and why this is the one.
--
--   2. THE DESCRIPTION REQUIREMENT EXTENDED FROM TWO REFERENCE TABLES TO ALL EIGHT, because her
--      standing rule is that a value carrying NO consequence must SAY so. Before this, only
--      `LegalForm` and `BusinessModel` carried `*_description_required`; the other six were
--      deliberately left blank on her EARLIER reasoning, which she has now reversed. Both arguments
--      are recorded in `reference-tables.spec.ts`'s header so reversing this again is one edit.
--
-- ## `member` IS THE ENUM TYPE, NOT A STRING, AND THAT IS THE DESIGN
--
-- A `TEXT` column would admit a row describing `DIRECTT` — a description of a member that does not
-- exist, read by nothing, findable only by a guard somebody has to remember to write. Typing the
-- column as the enum makes that unrepresentable and leaves exactly ONE property for a guard:
-- COMPLETENESS, which a database cannot express and which is therefore asserted below and in
-- `enum-descriptions.spec.ts`.
--
-- ## THE ROWS ARRIVE IN THIS MIGRATION, NOT ONLY IN THE SEED
--
-- Deferred register entry 33, earned earlier in this same close: data added by the SEED reaches only
-- databases where the seed has re-run, and item (f)'s permission code was therefore ABSENT from dev
-- while a migration-delivered code was present. No schema gate can see a missing row. So these
-- eleven arrive here, and the seed upserts them for idempotence rather than as their only source.
--
-- ## NO `organizationId` AND NO RLS
--
-- Measured against the eight reference tables, which carry neither: what a value MEANS is a general
-- fact, identical for every office. Filtering it per tenant would let one office be shown a
-- different meaning for `SANCTION` than another.

-- ---------------------------------------------------------------------------
-- 1. The four tables.
-- ---------------------------------------------------------------------------
CREATE TABLE "BrokerageKindDescription" (
  "member"        "BrokerageKind" NOT NULL,
  "descriptionAr" TEXT NOT NULL,
  CONSTRAINT "BrokerageKindDescription_pkey" PRIMARY KEY ("member")
);

CREATE TABLE "RegulatoryActionKindDescription" (
  "member"        "RegulatoryActionKind" NOT NULL,
  "descriptionAr" TEXT NOT NULL,
  CONSTRAINT "RegulatoryActionKindDescription_pkey" PRIMARY KEY ("member")
);

CREATE TABLE "RegulatoryActionBasisDescription" (
  "member"        "RegulatoryActionBasis" NOT NULL,
  "descriptionAr" TEXT NOT NULL,
  CONSTRAINT "RegulatoryActionBasisDescription_pkey" PRIMARY KEY ("member")
);

CREATE TABLE "IntegrationMethodDescription" (
  "member"        "IntegrationMethod" NOT NULL,
  "descriptionAr" TEXT NOT NULL,
  CONSTRAINT "IntegrationMethodDescription_pkey" PRIMARY KEY ("member")
);

-- ---------------------------------------------------------------------------
-- 2. The eleven descriptions, the owner's own words.
--
--    BROKER_REQUEST and SANCTION were checked against `license-standing.config.ts` before being
--    written: the art. 14/c deemed-cancellation applies to a BROKER_REQUEST suspension ONLY
--    (`deemedCancelled = basis === 'BROKER_REQUEST' && now > twoYearsAfter(effectiveFrom)`), and
--    whether it reaches an art. 21/b sanction is unsettled in the text and is not inferred. Both
--    lines say exactly that. Nothing was corrected.
-- ---------------------------------------------------------------------------
INSERT INTO "BrokerageKindDescription" ("member", "descriptionAr") VALUES
  ('DIRECT', 'وساطةٌ بين العميل وشركة التأمين، وهي عملُ مكاتب الوساطة في هذا النظام. بيانٌ يُسجَّل ولا يقرأه أيُّ فحصٍ أو حارس.'),
  ('REINSURANCE', 'وساطةٌ بين شركات التأمين وشركات إعادة التأمين. بيانٌ يُسجَّل ولا يقرأه أيُّ فحصٍ أو حارس. ولا يحمل هذا النظامُ نصّاً تنظيميّاً لوساطة إعادة التأمين، فلا يُعفي مَن يختاره من شيءٍ ولا يُلزِمه بشيء.')
ON CONFLICT ("member") DO NOTHING;

INSERT INTO "RegulatoryActionKindDescription" ("member", "descriptionAr") VALUES
  ('SUSPENSION', 'وقفُ الرخصة بفعلٍ من البنك المركزي. يُسجَّل بتاريخه ومستنده ولا يُعدَّل ولا يُحذَف بعد تسجيله، وحالةُ الرخصة تُستخرَج من هذه الأفعال ولا تُكتَب يداً.'),
  ('CANCELLATION', 'إلغاءُ الرخصة بفعلٍ من البنك المركزي. يُسجَّل بتاريخه ومستنده، ويبقى في السجل بعد أيِّ فعلٍ لاحق، لأنّ تاريخَ المكتب يُقرأ كاملاً لا آخرُه فقط.'),
  ('REINSTATEMENT', 'إعادةُ العمل بالرخصة بعد وقف. يُسجَّل بتاريخه ومستنده، ولا يمحو الوقفَ الذي سبقه.')
ON CONFLICT ("member") DO NOTHING;

INSERT INTO "RegulatoryActionBasisDescription" ("member", "descriptionAr") VALUES
  ('BROKER_REQUEST', 'الوقفُ جاء بطلبٍ من المكتب نفسِه وبموافقةٍ مسبقةٍ من البنك المركزي، وفق المادة (١٤/أ) من تعليمات رقم (٩) لسنة ٢٠٢٦. وإن امتدّ الوقفُ أكثرَ من سنتين تُعتبر الرخصةُ ملغاةً حكماً بمقتضى المادة (١٤/ج).'),
  ('SANCTION', 'الوقفُ جاء جزاءً من البنك المركزي، وفق المادة (٢١/ب). وسريانُ مدّة السنتين في المادة (١٤/ج) على هذه الحالة غيرُ محسومٍ في النصّ، والنظامُ لا يُقدِّره ولا يحتسبه.')
ON CONFLICT ("member") DO NOTHING;

INSERT INTO "IntegrationMethodDescription" ("member", "descriptionAr") VALUES
  ('API', 'التبادلُ يجري آليّاً بين النظامين عبر وصلةٍ برمجية، ويلزم تسجيلُ عنوان الوصلة. ولا تُحفَظ في هذه السجلات أيُّ كلمةِ مرورٍ أو مفتاحِ دخول.'),
  ('PORTAL', 'العملُ يجري على بوّابة الشركة الإلكترونية، يدخل إليها موظفُ المكتب بنفسه. ولا يحفظ النظامُ بياناتِ دخولِ البوّابة.'),
  ('EMAIL', 'التبادلُ يجري بالبريد الإلكتروني مع الشركة، ويُسجَّل العنوانُ المعتمَد لذلك.'),
  ('MANUAL', 'لا ربطَ إلكترونيّاً مع الشركة: التبادلُ ورقيٌّ أو هاتفيٌّ أو تسليمٌ باليد، ويُسجَّل ما يجري كما يجري.')
ON CONFLICT ("member") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The description requirement, extended to the remaining SIX reference tables.
--
--    `LegalForm` and `BusinessModel` already carry theirs. On a from-empty database these six are
--    EMPTY when the constraint is added, and the seed then inserts rows carrying descriptions; on an
--    existing database every row already has one (measured 44 of 44 on both before this ran).
-- ---------------------------------------------------------------------------
ALTER TABLE "LicensingAuthority" ADD CONSTRAINT "LicensingAuthority_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');
ALTER TABLE "RatingAgency" ADD CONSTRAINT "RatingAgency_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');
ALTER TABLE "Country" ADD CONSTRAINT "Country_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');
ALTER TABLE "City" ADD CONSTRAINT "City_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');
ALTER TABLE "Bank" ADD CONSTRAINT "Bank_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');

-- ---------------------------------------------------------------------------
-- 4. Assertions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT;
  checks  INTEGER;
  rows_ok INTEGER;
BEGIN
  -- COMPLETENESS, the one property the enum type cannot enforce: every member has a description.
  SELECT string_agg(t.label, ', ') INTO missing FROM (
    SELECT 'BrokerageKind.' || e::text AS label FROM unnest(enum_range(NULL::"BrokerageKind")) e
      WHERE e NOT IN (SELECT "member" FROM "BrokerageKindDescription")
    UNION ALL
    SELECT 'RegulatoryActionKind.' || e::text FROM unnest(enum_range(NULL::"RegulatoryActionKind")) e
      WHERE e NOT IN (SELECT "member" FROM "RegulatoryActionKindDescription")
    UNION ALL
    SELECT 'RegulatoryActionBasis.' || e::text FROM unnest(enum_range(NULL::"RegulatoryActionBasis")) e
      WHERE e NOT IN (SELECT "member" FROM "RegulatoryActionBasisDescription")
    UNION ALL
    SELECT 'IntegrationMethod.' || e::text FROM unnest(enum_range(NULL::"IntegrationMethod")) e
      WHERE e NOT IN (SELECT "member" FROM "IntegrationMethodDescription")
  ) t;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'these enum members have no Arabic description: %. A member a person can choose with nothing explaining it is the gap these tables exist to close.', missing;
  END IF;

  SELECT count(*) INTO rows_ok FROM (
    SELECT 1 FROM "BrokerageKindDescription"
    UNION ALL SELECT 1 FROM "RegulatoryActionKindDescription"
    UNION ALL SELECT 1 FROM "RegulatoryActionBasisDescription"
    UNION ALL SELECT 1 FROM "IntegrationMethodDescription"
  ) t;
  IF rows_ok <> 11 THEN
    RAISE EXCEPTION 'expected 11 enum descriptions, found %', rows_ok;
  END IF;

  -- All EIGHT reference tables now require one. Counted rather than assumed, so a future migration
  -- dropping one of the six is caught here rather than by a seed failing somewhere else.
  SELECT count(*) INTO checks FROM pg_constraint
  WHERE contype = 'c' AND conname LIKE '%_description_required';
  IF checks <> 8 THEN
    RAISE EXCEPTION 'expected 8 *_description_required CHECK constraints across the reference tables, found %', checks;
  END IF;

  RAISE NOTICE 'value descriptions: 11 enum members described, 8 reference tables require a description';
END $$;
