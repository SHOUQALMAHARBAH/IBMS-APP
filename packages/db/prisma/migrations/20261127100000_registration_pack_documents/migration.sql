-- MODULE 0-ب, DECISION 88 — THE TWO ART. 10/a REGISTRATION DOCUMENTS. THE RECORD SAVES, AND IT IS
-- MARKED INCOMPLETE.
--
-- ## WHY THIS IS A REOPEN
--
-- Art. 10/a is the document checklist for registering a brokerage office, and two of its mandatory
-- items were absent from the field dictionary and from item (d)'s brief:
--
--   art. 10/a/2 — «نسخة عن عقد الإيجار أو سند الملكية للمقر الخاص به»
--   art. 10/a/3 — «ما يثبت انتساب الوسيط الطبيعي أو المدير للأعمال التأمينية والقائم بأعمال الوساطة
--                  إلى الجمعية الأردنية لوسطاء التأمين»
--
-- Item (d) is delivered and green. The reason to reopen it before the module closes is specific: the
-- per-field report has not been produced yet. Produced now it is a correct report; produced after
-- these land it would claim that registration satisfies art. 10/a when it does not.
--
-- ## BOTH NULLABLE, AND THE LICENCE CERTIFICATE IS NOT THE PRECEDENT TO COPY
--
-- Decision 88: ABSENCE DOES NOT BLOCK SAVE. Neither document may refuse the form.
--
-- `BrokerLicense.certificateDocumentId` is NOT NULL and keeps blocking — but that was DISCOVERED
-- rather than chosen: the column was already NOT NULL when item (c) built the term series. So it is
-- not an argument for anything here, and no NOT NULL migration is written for these two.
--
-- The reason absence must not block is the one the marker's wording turns on. An office licensed by
-- the Central Bank DID submit these documents to the regulator — that is what being licensed means.
-- Our not holding a copy is OUR gap, not its violation, and a form that refused to record a licensed
-- office until we held our own copy would be refusing a fact in favour of our filing.
--
-- ## BROKERAGE OFFICES ONLY — rule 6, and the CHECK that makes it structural
--
-- Art. 10/a is the BROKER's document list. An insurance company is licensed under other articles, so
-- neither column may carry a value on one. The same shape as
-- `Organization_insurer_certificate_only_on_a_company`, pointing the other way, and written for the
-- reason item (b) established: a value nothing reads is a value somebody eventually reads.
--
-- ## NO COMPLETENESS COLUMN, AND THERE MUST NEVER BE ONE
--
-- Decision 88: completeness is DERIVED, never stored. No flag, no checkbox — computed from the
-- documents actually present, exactly as licence status is computed (decision 71). A stored flag
-- drifts from reality, which is the seed-drift defect class this project has caught twice.
--
-- ## THE ASSOCIATION PROOF CARRIES NO PERSON KEY, DELIBERATELY
--
-- Art. 10/a/3 attaches it to PERSONS — the natural broker, the insurance-business manager, the
-- practitioner — and none of them exists in the system at the moment an office is registered. So it
-- is held as a document in the office's registration pack with no person foreign key; the per-person
-- link belongs to the employees module.
--
-- Same shape as the minimum-staff guard the owner asked for at registration and then withdrew: do not
-- build a relation whose other side cannot exist. A column pointing at an `Employee` here would be a
-- precondition nothing can satisfy — § 1.62, which this project has shipped once already.

ALTER TABLE "Organization"
  -- Art. 10/a/2 — the lease contract or the title deed for the premises.
  ADD COLUMN "premisesTenureDocumentId" TEXT,
  -- Art. 10/a/3 — proof of membership of the Jordanian Insurance Brokers Association. NO person key.
  ADD COLUMN "associationMembershipDocumentId" TEXT;

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_premisesTenureDocumentId_fkey"
  FOREIGN KEY ("premisesTenureDocumentId") REFERENCES "Document"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_associationMembershipDocumentId_fkey"
  FOREIGN KEY ("associationMembershipDocumentId") REFERENCES "Document"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_registration_pack_only_on_an_office"
  CHECK (
    ("premisesTenureDocumentId" IS NULL AND "associationMembershipDocumentId" IS NULL)
    OR "type" = 'BROKERAGE_OFFICE'
  );

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n   INTEGER;
  org TEXT;
  doc TEXT;
BEGIN
  -- (1) The composite tenant foreign keys are all still there.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) BOTH COLUMNS ARE NULLABLE. Decision 88's first rule, asserted rather than assumed: a later
  --     migration tightening either to NOT NULL would make absence block a save, which is the one
  --     thing this decision forbids — and would also reinstate the circular foreign key, since the
  --     pointer is on the PARENT here exactly as the insurer certificate's is.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Organization"'::regclass AND attnotnull
     AND attname IN ('premisesTenureDocumentId', 'associationMembershipDocumentId');
  IF n <> 0 THEN
    RAISE EXCEPTION '% registration-pack column(s) are NOT NULL — absence would block a save, which decision 88 forbids', n;
  END IF;

  -- (3) NO COMPLETENESS COLUMN. Decision 88's second rule, in the form that can actually fail: a
  --     future column named anything like "complete" on this table is a stored flag that will drift
  --     from the documents it claims to summarise.
  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = '"Organization"'::regclass AND attnum > 0 AND NOT attisdropped
     AND (attname ILIKE '%complete%' OR attname ILIKE '%registrationpack%');
  IF n <> 0 THEN
    RAISE EXCEPTION 'Organization carries % completeness column(s). Completeness is DERIVED from the documents present, never stored — a stored flag drifts, which is the defect class this project has caught twice', n;
  END IF;

  -- (4) NO PERSON KEY on the association proof. Art. 10/a/3 attaches it to people who do not exist
  --     when an office is registered; a relation whose other side cannot exist is a precondition
  --     nothing can satisfy.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"Organization"'::regclass AND contype = 'f'
     AND confrelid = '"Employee"'::regclass;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Organization now references Employee — the association proof must carry no person key until the employees module exists';
  END IF;

  -- (5) THE CHECK REFUSES A COMPANY, PROVEN BY ATTEMPTING IT rather than by reading pg_constraint.
  SELECT id INTO doc FROM "Document" LIMIT 1;
  SELECT id INTO org FROM "Organization" WHERE "type" <> 'BROKERAGE_OFFICE' LIMIT 1;
  IF doc IS NOT NULL AND org IS NOT NULL THEN
    BEGIN
      UPDATE "Organization" SET "premisesTenureDocumentId" = doc WHERE id = org;
      RAISE EXCEPTION 'a non-brokerage organization accepted an art. 10/a registration document — the CHECK refuses nothing';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END IF;

  -- (6) ZERO ROWS MODIFIED. Nothing is backfilled: every existing office comes out of this with both
  --     columns NULL, which is exactly the state the marker is for.
  SELECT count(*) INTO n FROM "Organization"
   WHERE "premisesTenureDocumentId" IS NOT NULL
      OR "associationMembershipDocumentId" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Organization row(s) came out of this migration carrying a registration document — nothing here writes one', n;
  END IF;

  RAISE NOTICE 'registration pack: two nullable document columns, brokerage offices only, no completeness column, no person key';
END $$;
