-- MODULE 0 CLOSE, batch 5 group 7b — THE REGISTER OF EXTENDED RECORDS.
--
-- ## WHY A TABLE AND NOT A LONGER PERIOD
--
-- The retention period lives on `RetentionScheduleItem` and is ONE number per category. Extending
-- that number would extend the clock for every record in the category, including ones nobody was
-- asked about — and the brief's register must name WHICH RECORDS were extended, which a single
-- number cannot. So an extension is a row per record, and the clock reads it.
--
-- ## THE BASIS IS A CLOSED LIST OF THREE, AND THE DATABASE HOLDS IT TO THAT
--
-- `RetentionScheduleItem.legalBasis` is `String?` — any sentence, or nothing — and that is the shape
-- being replaced for this act. The adviser's reason: extending without legislative cover and without
-- the customer's consent "carries high legal risk and exposes the office to liability and penalties
-- under the Personal Data Protection Law". A field accepts a sentence that is not a basis at all.
--
-- So the enum is the list, and a CHECK per kind requires the thing that makes it substantiable:
-- a legislative provision needs its instrument AND its article; a hold needs the HOLD ROW; consent
-- needs the recorded consent plus its own stated duration and purpose.
--
-- CONSENT IS UNSELECTABLE IN THE APPLICATION TODAY and the column shape still requires its three
-- fields — deliberately. `ConsentRecord` carries a purpose, a grant date and a withdrawal date and
-- **no duration**, so the basis cannot be checked against what the customer agreed to. The day a
-- duration is recorded, this table already refuses a consent extension that does not carry one.

CREATE TYPE "RetentionExtensionBasis" AS ENUM (
  'LEGISLATIVE_PROVISION',
  'LEGAL_HOLD_OR_DISPUTE',
  'CUSTOMER_EXPLICIT_CONSENT'
);

CREATE TABLE "RetentionExtension" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT (current_setting('app.current_org_id', true)),

  -- The category as the office typed it, and the record inside it. `recordId` is a plain TEXT and
  -- carries NO foreign key, DELIBERATELY: the four resolvable categories are four different models
  -- (`Receipt`, `Remittance`, `CommissionLedgerEntry`, `Settlement`), so a real FK would need four
  -- nullable columns and a four-way CHECK to point at one row. The register's job is to say what was
  -- extended and on what basis — `Customer.ownerUserId` is the precedent for a deliberately
  -- unconstrained reference, and its own note records the cost: Postgres will accept any string here.
  "recordCategory" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,

  -- WHEN THE EXTENDED CLOCK ELAPSES. The notice reads this, so the same notice comes again with the
  -- same three choices once it passes — which is the half that makes an extension a decision rather
  -- than an exit.
  "extendedUntil" TIMESTAMP(3) NOT NULL,

  "basis" "RetentionExtensionBasis" NOT NULL,
  -- Free text ACCOMPANIES a basis and may not BE one. NOT NULL, because an extension has to be
  -- justifiable a year later and the basis alone says only which KIND of cover was claimed.
  "note" TEXT NOT NULL,

  "legislativeInstrument" TEXT,
  "legislativeArticle" TEXT,
  "legalHoldId" TEXT,
  "consentRecordId" TEXT,
  "consentDuration" TEXT,
  "consentPurpose" TEXT,

  "extendedByUserId" TEXT NOT NULL,
  "extendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RetentionExtension_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- `onDelete: RESTRICT` on both actors, explicitly. Prisma's default for an optional relation is
-- `SetNull`, and an extension whose basis pointed at a hold nobody can find, or which nobody is
-- recorded as having made, is an extension that cannot be justified — which is the whole point of
-- the register.
ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_extendedByUserId_fkey"
  FOREIGN KEY ("extendedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_legalHoldId_fkey"
  FOREIGN KEY ("legalHoldId") REFERENCES "LegalHold"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The composite FK below needs a unique on its TARGET. `Insurer_id_organizationId_key` is the
-- established precedent (migration `20261011100000`), and `Role` already carries the same pair for
-- the same reason. Adding it to `LegalHold` costs an index and makes the tenant FK expressible;
-- without it Postgres refuses with "there is no unique constraint matching given keys", which is
-- how this was found rather than reasoned about.
ALTER TABLE "LegalHold"
  ADD CONSTRAINT "LegalHold_id_organizationId_key" UNIQUE ("id", "organizationId");

-- THE COMPOSITE TENANT FK, so one office's extension cannot cite another office's legal hold —
-- which would make one office's retention depend on a fact it cannot see. Prisma cannot express
-- this, so it is a named entry in the divergence gate's expected set.
ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_legalHold_same_org_fkey"
  FOREIGN KEY ("legalHoldId", "organizationId")
  REFERENCES "LegalHold"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RetentionExtension_organizationId_idx" ON "RetentionExtension"("organizationId");
-- The clock's own read: "is this record extended past now".
CREATE INDEX "RetentionExtension_lookup_idx"
  ON "RetentionExtension"("organizationId", "recordCategory", "recordId", "extendedUntil" DESC);
CREATE INDEX "RetentionExtension_legalHoldId_idx" ON "RetentionExtension"("legalHoldId");
CREATE INDEX "RetentionExtension_extendedByUserId_idx" ON "RetentionExtension"("extendedByUserId");

-- EACH BASIS CARRIES WHAT MAKES IT SUBSTANTIABLE. A legislative basis with no article names no law;
-- a hold basis with no hold points at nothing; a consent basis with no duration cannot be checked
-- against what the customer agreed. The application refuses each of these first with a readable
-- sentence (decision 90 — a database constraint must never be the error message); this is the
-- backstop that makes an unsubstantiated row unrepresentable rather than merely rejected.
ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_basis_substantiated"
  CHECK (
    ("basis" = 'LEGISLATIVE_PROVISION'
      AND "legislativeInstrument" IS NOT NULL AND length(btrim("legislativeInstrument")) > 0
      AND "legislativeArticle" IS NOT NULL AND length(btrim("legislativeArticle")) > 0)
    OR ("basis" = 'LEGAL_HOLD_OR_DISPUTE' AND "legalHoldId" IS NOT NULL)
    OR ("basis" = 'CUSTOMER_EXPLICIT_CONSENT'
      AND "consentRecordId" IS NOT NULL
      AND "consentDuration" IS NOT NULL AND length(btrim("consentDuration")) > 0
      AND "consentPurpose" IS NOT NULL AND length(btrim("consentPurpose")) > 0)
  );

-- The note is the accompanying justification, so a blank one is a row that says nothing. The
-- application's floor is ten characters (the shared declaration minimum); the database refuses only
-- the degenerate case, so that no code path present or future can write an empty one.
ALTER TABLE "RetentionExtension"
  ADD CONSTRAINT "RetentionExtension_note_not_blank"
  CHECK (length(btrim("note")) > 0);

ALTER TABLE "RetentionExtension" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionExtension" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RetentionExtension_tenant_isolation" ON "RetentionExtension"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "RetentionExtension" TO ibms_app;

DO $$
DECLARE
  basis_def TEXT;
  note_def TEXT;
  rls RECORD;
  labels TEXT;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO labels
  FROM pg_enum WHERE enumtypid = 'public."RetentionExtensionBasis"'::regtype;
  IF labels <> 'LEGISLATIVE_PROVISION,LEGAL_HOLD_OR_DISPUTE,CUSTOMER_EXPLICIT_CONSENT' THEN
    RAISE EXCEPTION 'the basis list is a CLOSED THREE — found %', labels;
  END IF;

  -- Asserted by DEFINITION, not existence: a predicate loosened to `TRUE OR (…)` keeps the
  -- constraint name and refuses nothing, which is the plant that proved a definition check
  -- secondary and the refusal tests primary on `broker-kind.e2e-spec.ts`.
  SELECT pg_get_constraintdef(oid) INTO basis_def
  FROM pg_constraint WHERE conname = 'RetentionExtension_basis_substantiated';
  IF basis_def IS NULL THEN
    RAISE EXCEPTION 'the basis-substantiated CHECK does not exist';
  END IF;
  IF basis_def NOT LIKE '%legislativeArticle%'
     OR basis_def NOT LIKE '%legalHoldId%'
     OR basis_def NOT LIKE '%consentDuration%' THEN
    RAISE EXCEPTION 'the basis CHECK no longer names all three bases'' requirements — it reads %', basis_def;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO note_def
  FROM pg_constraint WHERE conname = 'RetentionExtension_note_not_blank';
  IF note_def IS NULL OR note_def NOT LIKE '%btrim%' THEN
    RAISE EXCEPTION 'the note-not-blank CHECK is missing or no longer trims — it reads %', note_def;
  END IF;

  SELECT relrowsecurity, relforcerowsecurity INTO rls
  FROM pg_class WHERE oid = 'public."RetentionExtension"'::regclass;
  IF NOT rls.relrowsecurity OR NOT rls.relforcerowsecurity THEN
    RAISE EXCEPTION 'RLS must be ENABLEd AND FORCEd — got enable=%, force=%',
      rls.relrowsecurity, rls.relforcerowsecurity;
  END IF;

  RAISE NOTICE 'retention extension register: 3 bases, 2 CHECKs, RLS enabled and forced';
END $$;
