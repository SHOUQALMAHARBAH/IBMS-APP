-- 🔴 OWNER DECISION 149 — A CERTIFICATE ISSUED AFTER THE POLICY CHANGED IS STORED TOO, BESIDE THE FIRST.
--
-- «كل شهادة تأمين سُلِّمت للعميل لها نسخة محفوظة: إذا تغيّرت الوثيقة ثم طُلبت شهادتها من جديد
--  حُفظت الشهادة الجديدة بجانب القديمة، وإذا لم يتغيّر شيء بقيت نسخة واحدة.»
--
-- Completes decision 142, which stored ONE copy per (policy, file name). Measured in message 44:
-- if an endorsement changed the policy and the certificate was downloaded again, the customer was
-- handed a NEW document and the stored copy stayed the FIRST one — a paper in the world with no
-- record of it here, which is the state 142 exists to end.
--
-- ## HOW «THE POLICY CHANGED» IS KNOWN, AND THE DECISION ITSELF RULES OUT THE OBVIOUS ANSWER
--
-- §٤ says plainly: «ولا يُعتمَد على بصمة الملف (ملف الـPDF لا يخرج متطابقاً في كل مرة)». That is
-- the defect message 44 already hit once — keying on the PDF digest produced two rows for two
-- downloads of the SAME certificate, because Chromium stamps a creation date into the output, so
-- a digest of the bytes identifies the RENDER and not the document.
--
-- ⟶ THE DIGEST IS TAKEN OVER THE RENDERED **HTML**, which is a pure function of everything the
--   certificate shows: the customer's legal name, the insurer's name, the policy number, the
--   insurance line, the inception and expiry dates, the currency, every sum insured, the template
--   body, and the language. It is deterministic where the PDF is not.
--
-- ⛔ AND IT IS NOT A HAND-WRITTEN LIST OF FIELDS. A list would have to be revisited every time the
--   template renders one more fact, and the day somebody forgot, a changed certificate would be
--   silently recognised as the old one and never stored — the exact failure this decision fixes,
--   reintroduced by an omission nothing would report. Hashing the template's own OUTPUT cannot
--   fall behind the template.
--
-- ## WHY THE COLUMN IS NULLABLE
--
-- NULL means «stored before decision 149, and what it showed was never recorded». Those rows
-- cannot be back-filled: recomputing their HTML needs the policy as it stood at ITS issuance,
-- which is not kept. Measured 2026-11-17 — dev holds **0** such rows and db-test holds **18**,
-- all of them cumulative e2e residue.
--
-- ⛔ They are NOT deleted to make the column NOT NULL. Decision 142 §٥ criterion 5 — no route
--   deletes a certificate — and `deletionLocked` is true on every one of them. A sentinel digest
--   was rejected for a simpler reason: it would be a value that claims to describe a document
--   nobody measured.
--
-- ⟶ The consequence is stated rather than hidden: the FIRST download of a pre-149 certificate
--   stores one row beside it, because the system cannot prove nothing changed and this decision's
--   whole subject is that a certificate handed over has a stored copy. Every download after that
--   one matches and adds nothing.

ALTER TABLE "DocumentContent" ADD COLUMN "issuedFactsSha256" TEXT;

-- 64 lowercase hex characters, on the same shape `sha256` already carries. Enforced rather than
-- trusted: this column decides whether a second certificate is stored, so a malformed value would
-- silently make every future issuance look like a new document.
ALTER TABLE "DocumentContent"
  ADD CONSTRAINT "DocumentContent_issuedFactsSha256_shape"
  CHECK ("issuedFactsSha256" IS NULL OR "issuedFactsSha256" ~ '^[0-9a-f]{64}$');

-- The lookup this column exists for: (document's policy, category, file name) is already indexed
-- on `Document`; this is the per-content half, so matching an existing certificate by its facts
-- does not scan.
CREATE INDEX "DocumentContent_issuedFactsSha256_idx"
  ON "DocumentContent" ("issuedFactsSha256");

DO $$
DECLARE n bigint; ok boolean;
BEGIN
  -- (a) THE COLUMN EXISTS AND IS NULLABLE. Read off the catalogue, not believed.
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_name = 'DocumentContent'
     AND column_name = 'issuedFactsSha256'
     AND is_nullable = 'YES'
     AND data_type = 'text';
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-after-change: issuedFactsSha256 is not a nullable text column';
  END IF;

  -- (b) NOTHING WAS BACK-FILLED. Every pre-existing row is NULL, which is what NULL means here.
  SELECT count(*) INTO n FROM "DocumentContent" WHERE "issuedFactsSha256" IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'certificate-after-change: % existing row(s) were given a facts digest', n;
  END IF;

  -- (c) THE CHECK IS REGISTERED.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conname = 'DocumentContent_issuedFactsSha256_shape' AND contype = 'c';
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-after-change: the shape CHECK is not on the table';
  END IF;

  -- (d) AND IT IS THE EXPRESSION INTENDED, read back off the catalogue.
  --
  -- ⚠️ THE REFUSAL IS NOT PROBED HERE, AND THAT IS A MEASUREMENT RATHER THAN A SHORTCUT.
  -- `DocumentContent` carries FOREIGN KEYS to `Document` and `Organization`, and a throwaway row
  -- holding a malformed digest has no parents — so the probe would be refused by the FK, and a
  -- handler that counted ANY refusal as a pass would report this CHECK proven on a run where it
  -- was never reached. The ordering of a CHECK against an FK is not something to rely on.
  --
  -- ⟶ What is asserted here is the DEFINITION: the constraint is registered (c) and its
  --   expression is the one written above (d). The refusal itself is proven in
  --   `certificate-stored.e2e-spec.ts`, over `APP_DATABASE_URL`, where a real certificate row
  --   with real parents exists and the UPDATE can only fail on this constraint.
  SELECT pg_get_constraintdef(oid) ~ '0-9a-f' INTO ok
    FROM pg_constraint WHERE conname = 'DocumentContent_issuedFactsSha256_shape';
  IF NOT ok THEN
    RAISE EXCEPTION 'certificate-after-change: the shape CHECK is not the hex expression written';
  END IF;
END $$;
