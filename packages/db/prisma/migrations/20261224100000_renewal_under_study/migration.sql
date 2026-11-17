-- MODULE 1 — OWNER DECISION 128: «التجديد قيد الدراسة» — THE PROOF OPENS ISSUANCE, NOT THE DATE.
--
-- «المكتب اللي خلص ترخيصه وقدّم التجديد بوقته ورفع إثبات التقديم بكمّل يصدر ويجدّد، وكل وثيقة
-- بتنوسم لحالها إنها صدرت والتجديد قيد الدراسة.»
--
-- ## WHAT WAS WRONG, MEASURED BEFORE THE DECISION (decision 128 §8)
--
-- `renewalFiledOnTime` compared a DATE with art. 11's deadline, `deriveLicenseStanding` returned
-- `RENEWAL_PENDING` with `mayPractise: true`, and the gate read `mayPractise` alone. **So a date
-- typed into a field opened all six issuance acts.** Decision 128's first rule is the correction:
-- «الإثبات يفتح، لا التاريخ».
--
-- ## THE FOUR CONDITIONS THIS MIGRATION MAKES STORABLE
--
-- Past the printed expiry of the latest term, the office may practise only if ALL FOUR hold:
--
--   1. filed by art. 11's deadline            — `renewalRequestedAt`, already here
--   2. a filing proof with date and reference — `renewalProofDocumentId` + `renewalReferenceNumber`
--   3. a standing declaration for that term   — `LicenseRenewalDeclaration`
--   4. no deficiency notice, no refusal since — `RegulatoryActionKind`'s two new members
--
-- Otherwise `EXPIRED`, `mayPractise: false`. **Before the printed expiry nothing changes**, and
-- only a NEW CERTIFICATE lifts a refusal: there is no cured state and no timer, so advancing the
-- clock a year changes nothing without a paper.
--
-- ## AND NOTHING HERE GRANTS A PERMISSION
--
-- `license-renewal.declare` is minted in the CATALOGUE (`seed-data/permissions.ts`) with
-- `introducedAt`, held by NO role, and arrives in each office marked «جديدة» — OWNER DECISION 131.
-- `npm run check:permission-migrations` refuses a migration that adds a permission and writes
-- `RolePermission` for it; this migration writes neither, deliberately.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. THE TWO NEW REGULATORY ACTS. Each does EXACTLY ONE THING: it ends the under-study state.
--
-- APPENDED, not inserted. Nothing orders by this enum, so a position would be a decision with no
-- consequence, and inserting mid-enum rewrites the sort order of every existing row for no gain —
-- the same call `20261220100000` made for `InteractionChannel`.
--
-- ⛔ NO BACK-FILL, and the assertion below pins it at zero. Not one existing `SUSPENSION` row is
-- re-read as a deficiency notice: a row recorded as a suspension was recorded that way by a
-- person, and re-reading it afterwards would be the system deciding what they meant.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TYPE "RegulatoryActionKind" ADD VALUE 'DEFICIENCY_NOTICE';
ALTER TYPE "RegulatoryActionKind" ADD VALUE 'RENEWAL_REFUSAL';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. THE FILING PROOF. Nullable, because the overwhelming majority of terms never need one — a
-- term inside its printed dates is simply valid — and because every term recorded before today
-- legitimately has none.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "BrokerLicense" ADD COLUMN "renewalProofDocumentId" TEXT;
ALTER TABLE "BrokerLicense" ADD COLUMN "renewalReferenceNumber" TEXT;

ALTER TABLE "BrokerLicense" ADD CONSTRAINT "BrokerLicense_renewalProofDocumentId_fkey"
  FOREIGN KEY ("renewalProofDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A PROOF IMPLIES ITS DATE AND ITS REFERENCE, AND NOT THE REVERSE.
--
-- Decision 128 §3 requires all three together — the file, the filing date, and the Central Bank's
-- inbound or reference number. But a DATE ALONE must stay storable: that is precisely the state
-- criterion 1 tests («شِل الإثبات ⟵ يُمنَع»), and it is the state every term recorded before today
-- is in. So the implication runs one way only.
ALTER TABLE "BrokerLicense" ADD CONSTRAINT "BrokerLicense_renewal_proof_carries_its_date_and_reference"
  CHECK (
    "renewalProofDocumentId" IS NULL
    OR ("renewalRequestedAt" IS NOT NULL AND btrim(COALESCE("renewalReferenceNumber", '')) <> '')
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3. THE STANDING DECLARATION. A NEW TABLE, AND `DeclaredAct`'s CHECKS ARE THE REASON.
--
-- Measured 2026-11-15 with `pg_get_constraintdef`: `DeclaredAct` refuses this record on four
-- counts — its reason floor (this has no free-text reason), its identifies-what-it-declares CHECK
-- (no article is breached and no single record is addressed), its article-text floor, and
-- `DeclaredActSite` being decision 126's seven. ⛔ They are not bent: that table is a register of
-- ADMITTED REGULATORY BREACHES and this is the opposite record — a statement that nothing has
-- gone wrong.
--
-- What IS copied is the hardening, which is the part that matters: the text as displayed, the
-- actor and the name as it stood, the timestamp, the network address, append-only triggers, and
-- FORCED row-level security.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE "LicenseRenewalDeclaration" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "brokerLicenseId"      TEXT NOT NULL,
  "declarationTextShown" TEXT NOT NULL,
  "permissionCode"       TEXT NOT NULL,
  "actorUserId"          TEXT NOT NULL,
  "actorNameShown"       TEXT NOT NULL,
  "declaredAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "networkAddress"       TEXT,

  CONSTRAINT "LicenseRenewalDeclaration_pkey" PRIMARY KEY ("id")
);

-- «مرة واحدة» — one standing declaration per term, expressed where it cannot be forgotten. A
-- second attempt is a 409 rather than an overwrite, which the append-only triggers below make
-- impossible anyway; the unique is what makes the refusal legible instead of a trigger error.
CREATE UNIQUE INDEX "LicenseRenewalDeclaration_brokerLicenseId_key"
  ON "LicenseRenewalDeclaration"("brokerLicenseId");
CREATE INDEX "LicenseRenewalDeclaration_organizationId_idx"
  ON "LicenseRenewalDeclaration"("organizationId");

ALTER TABLE "LicenseRenewalDeclaration" ADD CONSTRAINT "LicenseRenewalDeclaration_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LicenseRenewalDeclaration" ADD CONSTRAINT "LicenseRenewalDeclaration_brokerLicenseId_fkey"
  FOREIGN KEY ("brokerLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LicenseRenewalDeclaration" ADD CONSTRAINT "LicenseRenewalDeclaration_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The shown text is PROSE, not a tick. Decision 128 §3 requires the declaration be made in the
-- ratified sentence; the floor is the same 20 `DeclaredAct` uses for the texts it shows, because
-- it answers the same question — is this a sentence somebody read, or a checkbox?
ALTER TABLE "LicenseRenewalDeclaration" ADD CONSTRAINT "LicenseRenewalDeclaration_text_is_prose"
  CHECK (length(btrim("declarationTextShown")) >= 20);
ALTER TABLE "LicenseRenewalDeclaration" ADD CONSTRAINT "LicenseRenewalDeclaration_identifies_who_declared"
  CHECK (btrim("permissionCode") <> '' AND btrim("actorNameShown") <> '');

-- ROW-LEVEL SECURITY, ENABLED **AND FORCED** — the third table in this product to be forced,
-- after `LegalValue` and `DeclaredAct`. A register of who swore the Central Bank had refused
-- nothing is the wrong place to leave the table's owner exempt, and criterion 9 is exactly this.
ALTER TABLE "LicenseRenewalDeclaration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LicenseRenewalDeclaration" FORCE ROW LEVEL SECURITY;

-- Fail-closed: `current_setting(..., true)` is NULL when unset, and `col = NULL` is NULL and never
-- true — so a connection with no tenant context sees nothing rather than everything.
CREATE POLICY "LicenseRenewalDeclaration_tenant_isolation" ON "LicenseRenewalDeclaration"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- APPEND ONLY, UNDER EVERY PERMISSION. A permission cannot express this: any model that can grant
-- "edit" can be configured to grant it. UPDATE would let somebody rewrite the sentence they claim
-- to have read; DELETE would let them remove the record of having declared at all — and the whole
-- value of this record is that the office said so, on a day, in words, with a name against it.
CREATE FUNCTION prevent_license_renewal_declaration_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'LicenseRenewalDeclaration rows are append-only — the office declared that no refusal and no deficiency notice had arrived, and the record testifies to what was shown, so % is not permitted by any permission (OWNER DECISION 128)', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER license_renewal_declaration_no_update
  BEFORE UPDATE ON "LicenseRenewalDeclaration"
  FOR EACH ROW EXECUTE FUNCTION prevent_license_renewal_declaration_mutation();

CREATE TRIGGER license_renewal_declaration_no_delete
  BEFORE DELETE ON "LicenseRenewalDeclaration"
  FOR EACH ROW EXECUTE FUNCTION prevent_license_renewal_declaration_mutation();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4. THE STAMP — «صدرت والتجديد قيد الدراسة», on the five records the six issuance acts create.
--
-- `PLACE_POLICY` and `RENEW_POLICY` both make a `Policy`; `REQUEST_QUOTES` an `RFQ`;
-- `ISSUE_RECOMMENDATION` a `Recommendation`; `INCREASE_COVER` an `Endorsement`; and
-- `ISSUE_CERTIFICATE` 🔴 **a `Document` and nothing else** — there is no certificate model, which
-- is why the fifth column lands on the general documents table. OWNER DECISION 136 §6 settles
-- that the row the act creates is the row that carries the stamp.
--
-- NULLABLE EVERYWHERE, and NULL is the ordinary case: it means «issued under a licence that was
-- simply in force». So no other document kind, and no ordinary policy, is touched by these columns
-- existing.
--
-- ⛔ STAMPED AT CREATION, NEVER DERIVED — decision 124's principle. Derive it from the licence's
-- CURRENT state and the new certificate arriving would silently un-stamp every record issued in
-- the gap, so an inspector asking what was issued under study would be told «nothing». That is
-- also why there is no UPDATE path for these columns anywhere in the application.
--
-- ⛔ AND THE STAMP IS NOT PRINTED ON PAPER THE CUSTOMER RECEIVES — OWNER DECISION 136(أ), a ruling
-- rather than a deferral. These columns are what the SCREEN and the record read.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Policy" ADD COLUMN "issuedUnderStudyLicenseId" TEXT;
ALTER TABLE "RFQ" ADD COLUMN "issuedUnderStudyLicenseId" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN "issuedUnderStudyLicenseId" TEXT;
ALTER TABLE "Endorsement" ADD COLUMN "issuedUnderStudyLicenseId" TEXT;
ALTER TABLE "Document" ADD COLUMN "issuedUnderStudyLicenseId" TEXT;

ALTER TABLE "Policy" ADD CONSTRAINT "Policy_issuedUnderStudyLicenseId_fkey"
  FOREIGN KEY ("issuedUnderStudyLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_issuedUnderStudyLicenseId_fkey"
  FOREIGN KEY ("issuedUnderStudyLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_issuedUnderStudyLicenseId_fkey"
  FOREIGN KEY ("issuedUnderStudyLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_issuedUnderStudyLicenseId_fkey"
  FOREIGN KEY ("issuedUnderStudyLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_issuedUnderStudyLicenseId_fkey"
  FOREIGN KEY ("issuedUnderStudyLicenseId") REFERENCES "BrokerLicense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS. The migration proves what it just built, so a silent partial apply cannot pass.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- 1. The enum holds five members and the two new ones are present.
  SELECT COUNT(*) INTO n FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'RegulatoryActionKind';
  IF n <> 5 THEN
    RAISE EXCEPTION 'renewal-under-study: RegulatoryActionKind holds % members, expected 5', n;
  END IF;
  SELECT COUNT(*) INTO n FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'RegulatoryActionKind'
     AND e.enumlabel IN ('DEFICIENCY_NOTICE', 'RENEWAL_REFUSAL');
  IF n <> 2 THEN
    RAISE EXCEPTION 'renewal-under-study: the two new regulatory kinds are not both present (found %)', n;
  END IF;

  -- 2. NO BACK-FILL. Not one existing act was re-read as one of the new kinds.
  --
  -- ⚠️ `"kind"::text` RATHER THAN `"kind" IN ('DEFICIENCY_NOTICE', …)`, and the cast is the whole
  -- point: Postgres forbids USING a value added by `ALTER TYPE … ADD VALUE` in the transaction
  -- that added it, so the enum-literal form errors here. Casting the column to text compares two
  -- strings and never constructs the enum value, so the assertion is real rather than skipped —
  -- `20261220100000` could only say it had no back-fill «even in principle».
  SELECT COUNT(*) INTO n FROM "RegulatoryAction"
   WHERE "kind"::text IN ('DEFICIENCY_NOTICE', 'RENEWAL_REFUSAL');
  IF n <> 0 THEN
    RAISE EXCEPTION 'renewal-under-study: % existing act(s) carry a new kind — nothing may be re-read as a deficiency notice', n;
  END IF;

  -- 3. The declaration table starts EMPTY. A back-filled declaration would be the system swearing
  --    on an office's behalf that the Central Bank had refused nothing.
  SELECT COUNT(*) INTO n FROM "LicenseRenewalDeclaration";
  IF n <> 0 THEN
    RAISE EXCEPTION 'renewal-under-study: expected an empty declaration table, found % row(s)', n;
  END IF;

  -- 4. Row-level security is ENABLED **and FORCED**.
  SELECT COUNT(*) INTO n FROM pg_class
   WHERE relname = 'LicenseRenewalDeclaration' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'renewal-under-study: row-level security is not both ENABLED and FORCED';
  END IF;

  -- 5. The isolation policy exists.
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename = 'LicenseRenewalDeclaration'
     AND policyname = 'LicenseRenewalDeclaration_tenant_isolation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'renewal-under-study: the tenant isolation policy is missing';
  END IF;

  -- 6. Both append-only triggers exist.
  SELECT COUNT(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"LicenseRenewalDeclaration"'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'renewal-under-study: expected 2 append-only triggers, found %', n;
  END IF;

  -- 7. All FIVE stamp columns landed. A partial apply here is the worst case: the gap would be
  --    recorded on four record kinds and silently not on the fifth.
  SELECT COUNT(*) INTO n FROM information_schema.columns
   WHERE table_name IN ('Policy', 'RFQ', 'Recommendation', 'Endorsement', 'Document')
     AND column_name = 'issuedUnderStudyLicenseId';
  IF n <> 5 THEN
    RAISE EXCEPTION 'renewal-under-study: expected 5 stamp columns, found %', n;
  END IF;

  -- 8. And every one of them RESTRICTS, so the term a stamp names cannot be deleted out from
  --    under it. `SET NULL` here would quietly un-stamp the record, which is the one thing
  --    decision 128 §4 forbids.
  SELECT COUNT(*) INTO n FROM pg_constraint
   WHERE conname IN (
           'Policy_issuedUnderStudyLicenseId_fkey',
           'RFQ_issuedUnderStudyLicenseId_fkey',
           'Recommendation_issuedUnderStudyLicenseId_fkey',
           'Endorsement_issuedUnderStudyLicenseId_fkey',
           'Document_issuedUnderStudyLicenseId_fkey',
           'BrokerLicense_renewalProofDocumentId_fkey'
         )
     AND confdeltype = 'r';
  IF n <> 6 THEN
    RAISE EXCEPTION 'renewal-under-study: expected 6 RESTRICTing foreign keys, found %', n;
  END IF;

  -- 9. NOTHING IS STAMPED YET. The gap is recorded going forward, never reconstructed backwards:
  --    this migration cannot know which of the existing rows were issued past an expiry.
  SELECT COUNT(*) INTO n FROM (
    SELECT 1 FROM "Policy"         WHERE "issuedUnderStudyLicenseId" IS NOT NULL
    UNION ALL SELECT 1 FROM "RFQ"            WHERE "issuedUnderStudyLicenseId" IS NOT NULL
    UNION ALL SELECT 1 FROM "Recommendation" WHERE "issuedUnderStudyLicenseId" IS NOT NULL
    UNION ALL SELECT 1 FROM "Endorsement"    WHERE "issuedUnderStudyLicenseId" IS NOT NULL
    UNION ALL SELECT 1 FROM "Document"       WHERE "issuedUnderStudyLicenseId" IS NOT NULL
  ) q;
  IF n <> 0 THEN
    RAISE EXCEPTION 'renewal-under-study: % row(s) are already stamped — nothing may be back-stamped', n;
  END IF;

  -- 10. And no term claims a proof without its date and reference.
  SELECT COUNT(*) INTO n FROM "BrokerLicense"
   WHERE "renewalProofDocumentId" IS NOT NULL
     AND ("renewalRequestedAt" IS NULL OR btrim(COALESCE("renewalReferenceNumber", '')) = '');
  IF n <> 0 THEN
    RAISE EXCEPTION 'renewal-under-study: % term(s) carry a proof with no date or no reference', n;
  END IF;
END $$;
