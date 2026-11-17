-- 🔴 OWNER DECISION 142 — AN ISSUED INSURANCE CERTIFICATE IS STORED, AND ITS ROW CARRIES THE STAMP.
--
-- «كل شهادة تأمين تصدر تُحفَظ ملفاً في النظام بسطر في جدول الملفات، وذلك السطر يحمل ختم «صدرت
--  والتجديد قيد الدراسة» حين يلزم.»
--
-- ## WHY THIS MIGRATION EXISTS AT ALL, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE
--
-- Decision 136 §6 settled that the renewal stamp goes on «the `Document` row that the
-- `ISSUE_CERTIFICATE` act creates». Measured 2026-11-15: **the act creates none.** The service
-- renders a PDF and returns a buffer, the route returns a `StreamableFile`, and nothing writes a
-- record — and the same is true of the policy schedule summary and the recommendation report.
--
-- 🔴 AND A SECOND MEASUREMENT MADE IT BIGGER THAN A ROW. `Document.storageRef` is an object
-- storage key supplied by the UPLOADER, and no service in this API writes object storage. So
-- **every `Document` row in this product is a pointer with nothing behind it**, and persisting a
-- certificate needs somewhere for the bytes to actually be.
--
-- ⟶ Her ruling (§3): the bytes live in the DATABASE until a storage service is built with the
--   hosting decision, and then they move. The move is a recorded item, not a hope.
--
-- ## WHAT THIS DOES NOT DO
--
-- §4: the policy schedule summary and the recommendation report are NOT stored by this decision —
-- their records (`Policy`, `Recommendation`) already exist and already carry the stamp, which the
-- renewal-under-study migration added. And retention — how long a stored certificate is kept and
-- when it is destroyed — is module 11's question. Until it is answered **nothing is deleted**,
-- which `Document.deletionLocked` already defaults to and this migration asserts.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0. THE CATEGORY. «show me the certificates we issued» has to be a query.
--
-- Its own value for the same reason `BROKER_LICENSE_CERTIFICATE` has one. `POLICY` would bury
-- issued certificates among the policy documents an office uploaded, and `OTHER` is — by that
-- enum's own comment — where a document goes to be lost.
--
-- ⚠️ `ALTER TYPE … ADD VALUE` CANNOT USE THE NEW VALUE IN THE SAME TRANSACTION. Postgres refuses
-- the enum literal here, so the no-back-fill assertion below compares the column CAST TO `::text`
-- — which is a real assertion, where the previous enum migration could only say it had none «even
-- in principle».
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'CERTIFICATE_OF_INSURANCE';

DO $$
DECLARE n bigint;
BEGIN
  -- (a) THE MEMBER EXISTS. Read off the catalogue rather than believed.
  SELECT count(*) INTO n
    FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
   WHERE ty.typname = 'DocumentCategory' AND e.enumlabel = 'CERTIFICATE_OF_INSURANCE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-stored: CERTIFICATE_OF_INSURANCE is not a DocumentCategory member';
  END IF;

  -- (b) NOTHING WAS BACK-FILLED ONTO IT. No existing document becomes a certificate by this
  --     migration running; the only rows that will ever carry it are ones the act creates.
  SELECT count(*) INTO n
    FROM "Document" WHERE "category"::text = 'CERTIFICATE_OF_INSURANCE';
  IF n <> 0 THEN
    RAISE EXCEPTION 'certificate-stored: % existing Document row(s) were given the new category', n;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. THE BYTES.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "DocumentContent" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "documentId"     TEXT NOT NULL,
  "bytes"          BYTEA NOT NULL,
  "byteSize"       INTEGER NOT NULL,
  "contentType"    TEXT NOT NULL,
  "sha256"         TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentContent_pkey" PRIMARY KEY ("id")
);

-- ONE row per document. A second would be a second answer to «what is this file?».
CREATE UNIQUE INDEX "DocumentContent_documentId_key" ON "DocumentContent"("documentId");
CREATE INDEX "DocumentContent_organizationId_idx" ON "DocumentContent"("organizationId");

ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT, because the bytes ARE the document: criterion 5 is «no route deletes the
-- certificate», and a cascade here would make the file removable by removing its record.
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- THE DECLARED LENGTH CANNOT LIE. `byteSize` exists so a reader need not load a megabyte to learn
-- how big it is — and tying it to `octet_length(bytes)` is what stops it becoming a second,
-- disagreeing answer. ⛔ Never relax this to a range: the two numbers are one fact.
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_byteSize_is_the_real_length"
  CHECK ("byteSize" = octet_length("bytes"));

-- THE CAP — 2 MiB, and the figure is chosen rather than inherited.
--
-- A certificate is a ONE-PAGE bilingual PDF this system renders itself through Chromium; nobody
-- uploads it, so no caller controls its size. The nearest precedent is `LEGACY_IMPORT_MAX_BYTES`
-- (5 MiB) and it answers a DIFFERENT question — a customer's own back-book file, where the office
-- chooses what to send. ⟶ This cap exists because the bytes sit in the DATABASE temporarily
-- (§3), so the right size is «comfortably more than a generated page, far less than a file
-- somebody could aim at us». `certificate-stored.e2e-spec.ts` asserts a real rendered certificate
-- sits well under it, so the headroom is measured rather than asserted.
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_byteSize_within_cap"
  CHECK ("byteSize" > 0 AND "byteSize" <= 2097152);

-- 64 lowercase hex characters, so criterion 1's «يُقرأ كما صدر» is CHECKABLE: hash what comes
-- back and compare. A blank or truncated hash would make that check pass vacuously.
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_sha256_is_a_digest"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "DocumentContent" ADD CONSTRAINT "DocumentContent_contentType_is_stated"
  CHECK (btrim("contentType") <> '');

-- ROW-LEVEL SECURITY, ENABLED **AND FORCED** — the fourth forced table, after `LegalValue`,
-- `DeclaredAct` and `LicenseRenewalDeclaration`. Criterion 4 is «another office sees neither the
-- certificate nor its row», and a certificate names a customer, an insurer and a sum insured.
ALTER TABLE "DocumentContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentContent" FORCE ROW LEVEL SECURITY;

-- Fail-closed: `current_setting(..., true)` is NULL when unset, and `col = NULL` is never true, so
-- a connection with no tenant context sees nothing rather than everything.
CREATE POLICY "DocumentContent_tenant_isolation" ON "DocumentContent"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- APPEND ONLY, UNDER EVERY PERMISSION — criterion 1's «ويُقرأ كما صدر» and criterion 5's «لا مسار
-- يحذف الشهادة», made structural rather than promised. A certificate that could be UPDATED is not
-- the certificate that was issued, and the `sha256` beside it would then be the digest of
-- something nobody ever received. A permission cannot express this: any model that can grant
-- "edit" can be configured to grant it.
CREATE FUNCTION prevent_document_content_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'DocumentContent rows are append-only — a stored certificate is read back exactly as it was issued, so % is not permitted by any permission (OWNER DECISION 142)', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER document_content_no_update
  BEFORE UPDATE ON "DocumentContent"
  FOR EACH ROW EXECUTE FUNCTION prevent_document_content_mutation();

CREATE TRIGGER document_content_no_delete
  BEFORE DELETE ON "DocumentContent"
  FOR EACH ROW EXECUTE FUNCTION prevent_document_content_mutation();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. ASSERTIONS. Every one is a real refusal or a real count, run here rather than believed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INTEGER;
BEGIN
  -- (a) The table is EMPTY. No back-fill: a certificate that was streamed and never stored
  -- cannot be reconstructed, and inventing rows for the ones already handed to customers would
  -- put bytes in the record that nobody ever received.
  SELECT count(*) INTO n FROM "DocumentContent";
  IF n <> 0 THEN
    RAISE EXCEPTION 'certificate-stored: expected an empty content table, found % row(s)', n;
  END IF;

  -- (b) RLS is ENABLED **and** FORCED. Checked as two booleans, because ENABLE alone leaves the
  -- table's owner exempt and that is exactly the hole criterion 4 is about.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'DocumentContent' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-stored: row-level security is not both ENABLED and FORCED';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'DocumentContent' AND policyname = 'DocumentContent_tenant_isolation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-stored: the tenant isolation policy is missing';
  END IF;

  -- (c) Both append-only triggers exist. Counted, because one of the two is the common mistake.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"DocumentContent"'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'certificate-stored: expected 2 append-only triggers, found %', n;
  END IF;

  -- (d) Both foreign keys RESTRICT. A cascade on either would delete a certificate by deleting
  -- something else, which is criterion 5 defeated sideways.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"DocumentContent"'::regclass AND contype = 'f' AND confdeltype = 'r';
  IF n <> 2 THEN
    RAISE EXCEPTION 'certificate-stored: expected 2 RESTRICTing foreign keys, found %', n;
  END IF;

  -- (e) `deletionLocked` still defaults to TRUE on `Document`. Decision 142 §4 rests on it:
  -- retention is module 11's question and until it is answered nothing is deleted. Asserted
  -- rather than assumed, because this migration's whole argument leans on a default it does not
  -- itself set.
  SELECT count(*) INTO n FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = '"Document"'::regclass
     AND a.attname = 'deletionLocked'
     AND pg_get_expr(d.adbin, d.adrelid) = 'true';
  IF n <> 1 THEN
    RAISE EXCEPTION 'certificate-stored: Document.deletionLocked no longer defaults to true';
  END IF;
END $$;

-- (f) THE CAP AND THE LENGTH CHECK REFUSE FOR REAL, inside a block that rolls back. A CHECK that
-- is never exercised is a CHECK nobody has seen work.
DO $$
DECLARE
  org  TEXT;
  doc  TEXT;
  ok   BOOLEAN;
BEGIN
  SELECT id INTO org FROM "Organization" LIMIT 1;
  IF org IS NULL THEN
    -- A database with no office cannot carry a document, so there is nothing to probe and
    -- nothing to hide. Stated rather than skipped silently.
    RAISE NOTICE 'certificate-stored: no Organization on this database, so the CHECK probes are skipped';
    RETURN;
  END IF;

  SELECT id INTO doc FROM "Document" WHERE "organizationId" = org LIMIT 1;
  IF doc IS NULL THEN
    RAISE NOTICE 'certificate-stored: no Document on this database, so the CHECK probes are skipped';
    RETURN;
  END IF;

  -- 🔴 THE TENANT CONTEXT, AND WITHOUT IT THESE PROBES ONLY RUN WHERE THE ROLE BYPASSES RLS.
  --
  -- This table is `FORCE ROW LEVEL SECURITY`, so its OWNER is not exempt either. Measured
  -- 2026-11-16, the hard way: the first version of this block had no `set_config`, passed
  -- `from-empty.sh` 174/174 green, and then failed on the DEV database with
  -- «new row violates row-level security policy». The reason is the one `tenant-isolation`
  -- already records — `ibms` is a superuser with BYPASSRLS on the db-test cluster and NEITHER on
  -- dev — so the probe was asserting the CHECK through a connection that skipped the policy.
  --
  -- ⟶ `from-empty.sh` CANNOT catch this class, structurally: it builds its throwaway database on
  --   the db-test cluster, as the bypassing role. A migration that writes to a FORCED table must
  --   set this GUC or it is portable only by accident.
  --
  -- `true` = transaction-local, so it is gone with the rollback below like everything else here.
  PERFORM set_config('app.current_org_id', org, true);

  -- A declared length that disagrees with the bytes must be refused.
  ok := FALSE;
  BEGIN
    INSERT INTO "DocumentContent"("id","organizationId","documentId","bytes","byteSize","contentType","sha256")
    VALUES ('probe-len', org, doc, '\x2550'::bytea, 9999, 'application/pdf',
            repeat('a', 64));
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'certificate-stored: a byteSize that disagrees with the bytes was ACCEPTED';
  END IF;

  -- A hash that is not a digest must be refused, or criterion 1's check passes vacuously.
  ok := FALSE;
  BEGIN
    INSERT INTO "DocumentContent"("id","organizationId","documentId","bytes","byteSize","contentType","sha256")
    VALUES ('probe-sha', org, doc, '\x2550'::bytea, 2, 'application/pdf', 'not-a-digest');
  EXCEPTION WHEN check_violation THEN ok := TRUE;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'certificate-stored: a sha256 that is not a digest was ACCEPTED';
  END IF;

  -- Everything above is rolled back: a probe row in a table that refuses DELETE under every
  -- permission would be permanent residue in the record an inspector reads.
  RAISE EXCEPTION 'certificate-stored: probes done, rolling back' USING ERRCODE = 'check_violation';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'certificate-stored: probes done, rolling back' THEN
    RAISE;
  END IF;
END $$;
