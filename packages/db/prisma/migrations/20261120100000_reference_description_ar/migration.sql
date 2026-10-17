-- MODULE 0-ب ITEM (c), COMPLETED — an Arabic description where, and only where, a value carries a
-- rule.
--
-- ============================================================================================
-- THE GAP THE OWNER FOUND WHILE WRITING THE DESCRIPTIONS
-- ============================================================================================
-- The eight were built on `InsuranceLine`'s shape — code, English name, Arabic name, display order
-- — which carries NO description column. So the standing decision that every reference value has an
-- Arabic explanation had nowhere to live in these tables. Found by trying to use it, which is the
-- only way that kind of gap surfaces.
--
-- ============================================================================================
-- NOT A DESCRIPTION ON ALL EIGHT, AND THE REASON IS THE WHOLE DESIGN
-- ============================================================================================
-- The owner's words:
--
--   > A city, a bank and a country are satisfied by their Arabic name — the name IS the Arabic, and
--   > a description there would only restate it, which trains people to stop reading descriptions at
--   > exactly the point where one matters.
--
-- So the column is NULLABLE everywhere and REQUIRED only where the value carries a consequence the
-- name does not convey. `SOLE_ESTABLISHMENT` without art. 10/a/1/a beside it is a label nobody can
-- act on.
--
-- ============================================================================================
-- MEASURED: TWO OF THE EIGHT ARE RULE-BEARING, NOT FOUR
-- ============================================================================================
-- The owner named four — legal form, business model, brokerage kind, integration method. Two of
-- those are NOT TABLES: `BrokerageKind` and `IntegrationMethod` are enums, with no row to hang a
-- description on. Their Arabic lives in `apps/web/lib/i18n/translations/enums.ts`, reached through
-- `ENUM_LABEL`, and that is where the reinsurance sentence belongs.
--
-- The remaining six were each checked against "does any row carry a consequence the name does not
-- convey", and none does:
--
--   Country (JO) · City (12 governorates) · Bank (14) · LicensingAuthority (CBJ) ·
--   RatingAgency (4) · Currency (JOD, USD, EUR)
--
-- Currency was the one worth arguing about: JOD carries a real system consequence, since every
-- money column is `Decimal(18,3)` because the dinar divides into 1000 fils. But that is a fact about
-- the SCHEMA, not a rule a person applies when choosing the value — nobody picks a currency
-- differently for knowing it. It stays a proper noun.
--
-- ============================================================================================
-- WHY A CHECK AND NOT JUST A SEED CONVENTION
-- ============================================================================================
-- A convention is satisfied by the seed and then broken by the first provider who adds a legal form
-- through a screen. The CHECK makes the rule a property of the table: a rule-bearing row without its
-- rule cannot be stored at all.
--
-- The six proper-noun tables get NO constraint — absence is permitted there, which is the point.

ALTER TABLE "Country"            ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "City"               ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "Bank"               ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "Currency"           ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "LicensingAuthority" ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "RatingAgency"       ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "LegalForm"          ADD COLUMN "descriptionAr" TEXT;
ALTER TABLE "BusinessModel"      ADD COLUMN "descriptionAr" TEXT;

-- The seed supplies these in the same release, so the CHECK is added AFTER the backfill below
-- rather than before it — a constraint added first would refuse the very UPDATE that satisfies it.
--
-- PROVISIONAL WORDING, and labelled so in the register. The owner is writing the final Arabic; what
-- is written here is the ARTICLE each value carries, which is the part that cannot be guessed and
-- the part she named when she asked for the column. Replacing the prose later changes no rule.
UPDATE "LegalForm" SET "descriptionAr" = CASE "code"
  WHEN 'SOLE_ESTABLISHMENT'   THEN 'الشكل القانوني لوسيط التأمين الطبيعي. المادة 10/أ/1/أ من تعليمات رقم (9) لسنة 2026 تشترط تسجيل طالب الترخيص كوسيط تأمين طبيعي كمؤسسة فردية. ولا يجوز لهذا الشكل فتح أكثر من خمسة فروع (المادة 13/ب).'
  WHEN 'PUBLIC_SHAREHOLDING'  THEN 'شركة مساهمة عامة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.'
  WHEN 'PRIVATE_SHAREHOLDING' THEN 'شركة مساهمة خاصة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.'
  WHEN 'LIMITED_LIABILITY'    THEN 'شركة ذات مسؤولية محدودة. أحد الأشكال الثلاثة التي تجيز لها المادة 13/ب/4 فتح أكثر من خمسة فروع داخل المملكة أو فروع خارجها، بشروط أخرى مجتمعة معها.'
  WHEN 'GENERAL_PARTNERSHIP'  THEN 'شركة تضامن. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع.'
  WHEN 'LIMITED_PARTNERSHIP'  THEN 'شركة توصية بسيطة. شكل اعتباري لا تذكره المادة 13/ب/4 ضمن الأشكال المؤهلة لفتح أكثر من خمسة فروع، فلا ينطبق عليه ذلك التوسّع.'
  ELSE "descriptionAr" END;

UPDATE "BusinessModel" SET "descriptionAr" = CASE "code"
  WHEN 'CONVENTIONAL' THEN 'نمط النشاط التقليدي. يحدّد صياغة العروض والوثائق ومصطلحاتها، وتُشتقّ هذه الصياغة من قوالب مرتبطة بهذا السطر — لا من شرط في الشيفرة، حتى يكون إدخال نمط ثالث سطراً وقوالبَ لا إصداراً جديداً.'
  WHEN 'TAKAFUL'      THEN 'نمط النشاط التكافلي. يحدّد صياغة العروض والوثائق ومصطلحاتها (اشتراك بدل قسط، وفائض بدل ربح)، وتُشتقّ من قوالب مرتبطة بهذا السطر لا من شرط في الشيفرة. قوالب المصطلحات التكافلية لم تُبنَ بعد — انظر سجلّ المؤجَّل.'
  ELSE "descriptionAr" END;

ALTER TABLE "LegalForm"
  ADD CONSTRAINT "LegalForm_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');

ALTER TABLE "BusinessModel"
  ADD CONSTRAINT "BusinessModel_description_required"
  CHECK ("descriptionAr" IS NOT NULL AND btrim("descriptionAr") <> '');

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  t   TEXT;
  n   INTEGER;
  all8 TEXT[] := ARRAY['Country','City','Bank','Currency','LicensingAuthority',
                       'RatingAgency','LegalForm','BusinessModel'];
BEGIN
  -- 1. The column exists on all eight, and is NULLABLE on all eight. The requirement is carried by
  --    the CHECK on two, never by NOT NULL — because NOT NULL on the six would force a restating
  --    description for every city, which is the thing the design refuses.
  FOREACH t IN ARRAY all8 LOOP
    SELECT count(*) INTO n FROM pg_attribute
     WHERE attrelid = format('%I', t)::regclass AND attname = 'descriptionAr'
       AND attnum > 0 AND NOT attisdropped AND NOT attnotnull;
    IF n <> 1 THEN
      RAISE EXCEPTION 'reference descriptions: %.descriptionAr is missing or NOT NULL', t;
    END IF;
  END LOOP;

  -- 2. Every rule-bearing row HAS one — proven on the data, not on the constraint's existence.
  SELECT count(*) INTO n FROM "LegalForm"
   WHERE "descriptionAr" IS NULL OR btrim("descriptionAr") = '';
  IF n <> 0 THEN
    RAISE EXCEPTION 'reference descriptions: % LegalForm row(s) carry no Arabic description', n;
  END IF;
  SELECT count(*) INTO n FROM "BusinessModel"
   WHERE "descriptionAr" IS NULL OR btrim("descriptionAr") = '';
  IF n <> 0 THEN
    RAISE EXCEPTION 'reference descriptions: % BusinessModel row(s) carry no Arabic description', n;
  END IF;

  -- 3. And they are ARABIC. A description present but written in Latin script is present,
  --    non-empty and useless on an Arabic-first screen — the half a NOT NULL cannot see, and the
  --    same gap the reference-table seed spec already guards for `nameAr`.
  SELECT count(*) INTO n FROM "LegalForm" WHERE "descriptionAr" !~ '[؀-ۿ]';
  IF n <> 0 THEN
    RAISE EXCEPTION 'reference descriptions: % LegalForm description(s) contain no Arabic script', n;
  END IF;
  SELECT count(*) INTO n FROM "BusinessModel" WHERE "descriptionAr" !~ '[؀-ۿ]';
  IF n <> 0 THEN
    RAISE EXCEPTION 'reference descriptions: % BusinessModel description(s) contain no Arabic script', n;
  END IF;

  -- 4. PROVEN, not asserted: the CHECK refuses a rule-bearing row with no description. Written in a
  --    nested block that rolls itself back, through the table OWNER, which is the harshest caller.
  BEGIN
    INSERT INTO "BusinessModel" ("id","code","nameEn","nameAr","displayOrder")
      VALUES ('00000000-0000-0000-0000-0000000000b1','PROBE_NO_DESC','Probe','فحص', 999);
    RAISE EXCEPTION 'reference descriptions: a BusinessModel row with no description was ACCEPTED';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM "BusinessModel" WHERE "code" = 'PROBE_NO_DESC';
  IF n <> 0 THEN
    RAISE EXCEPTION 'reference descriptions: the refusal probe leaked % row(s)', n;
  END IF;

  RAISE NOTICE 'reference descriptions: column on all 8 and nullable; required and Arabic on LegalForm and BusinessModel; refusal proven.';
END $$;
