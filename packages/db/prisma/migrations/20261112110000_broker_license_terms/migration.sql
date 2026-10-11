-- MODULE 0, ITEM (c), PART 2 OF 2: THE LICENCE BECOMES A SERIES OF TERMS.
--
-- ============================================================================================
-- WHAT WAS ACTUALLY WRONG — one row PLATFORM-WIDE, not one per office
-- ============================================================================================
-- The brief for this item described the old shape as "one row per office, written over on
-- renewal". The second half is right. The first half understates it, and the correction is the
-- reason this migration exists in the form it does.
--
-- `BROKER_LICENSE_SINGLETON_ID = 'the-broker-license'` was used as the PRIMARY KEY:
-- `create()` passed `id: BROKER_LICENSE_SINGLETON_ID` and `findCurrent()` did a `findUnique` on
-- it. `BrokerLicense.id` is the global primary key, so there could be at most ONE licence row in
-- the entire database. Proven on dev in a rolled-back transaction: office A inserts (`INSERT 0 1`),
-- office B runs the same code path and gets
--
--     ERROR: duplicate key value violates unique constraint "BrokerLicense_pkey"
--     DETAIL: Key (id)=(the-broker-license) already exists.
--
-- So the SECOND office could never hold a licence at all — and because its `findCurrent()` then
-- returned NULL, `PolicyService.assertLicenseNotLapsed()` read that as "not blocked" and let it
-- place new business unchecked. A control that silently passes for every office but the first.
--
-- Renewal was an `updateMany` over that same row, so the term being replaced was erased: the
-- office could not show a regulator what it had been licensed for last year.
--
-- ============================================================================================
-- A TERM IS A ROW. RENEWAL APPENDS.
-- ============================================================================================
-- Each row is one licence term and carries its number, issue date, expiry, status, the certificate
-- (mandatory — below), and whether a renewal application has been filed for the term after it.
--
-- `certificateDocumentId` IS NOT NULL, which is what makes the certificate mandatory rather than
-- merely requested by a DTO. A term is the broker's evidence that it may lawfully practise;
-- recording one with nothing behind it records a claim instead of a fact. `ON DELETE RESTRICT`
-- because the document IS that evidence — the same reasoning as
-- `CustomerIdentifierCorrection`'s prior-result FK.
--
-- NOTE ON WHAT A `Document` IS IN THIS SYSTEM, so the NOT NULL is not read as more than it is:
-- there is no object storage anywhere in this application (pre-existing, documented). A `Document`
-- row records a file — its name, category, classification, who filed it and when — and
-- `storageRef` names a location nothing can currently fetch. So this column guarantees that a term
-- cannot be recorded without the certificate being FILED AND ATTRIBUTED. It does not guarantee the
-- bytes are retrievable, and nothing in this migration claims otherwise.
--
-- NO ONE-ACTIVE-PER-OFFICE CONSTRAINT, deliberately. A renewal application is due 45 days before
-- expiry (art. 11), so an outgoing and an incoming term can both legitimately read `active` at the
-- same time. The unique is on (organizationId, licenseNumber, expiresAt) — enough to refuse an
-- accidental duplicate of the same term, not enough to refuse a real overlap.
--
-- ============================================================================================
-- THE PRE-EXISTING ROW: WHERE IT WENT, AND WHY NO CHOICE WAS NEEDED
-- ============================================================================================
-- db-test holds exactly one `BrokerLicense` (`CBJ-RC-E2E-1`, expiring 2099-01-01), created by
-- `regulatory-compliance.e2e-spec.ts`. dev holds none.
--
-- It is NOT orphaned and NOT dropped. It keeps the office it already had: measured, its
-- `organizationId` is already `00000000-0000-0000-0000-000000000001` — "Default Brokerage Office"
-- — because `tenantScopeExtension` populated that column when the spec created the row. So there
-- was no assignment decision to make; the only thing wrong with the row was its PRIMARY KEY, and
-- that is what changes. Nothing references `BrokerLicense.id` by foreign key (measured: zero
-- inbound FKs), so re-keying it is safe.
--
-- Its certificate is BACKFILLED AS AN EXPLICIT ABSENCE. The NOT NULL has to hold, and inventing a
-- certificate for a term that never had one would be the lie this column exists to prevent — so
-- the Document created for it SAYS SO in its own filename and storage reference. A reader who
-- finds it learns that this term predates the requirement, which is true, instead of finding a
-- plausible-looking certificate that was never issued.
--
-- `organizationId` is set EXPLICITLY on that Document. `Document.organizationId` defaults to
-- `current_setting('app.current_org_id', true)`, which is NULL inside a migration — the lesson of
-- `20261103100000`, where an assertion's answer depended on which database it ran against.

ALTER TABLE "BrokerLicense" ADD COLUMN "certificateDocumentId" TEXT;
ALTER TABLE "BrokerLicense" ADD COLUMN "renewalRequestedAt" TIMESTAMP(3);

-- One certificate-of-record per pre-existing term, carrying the term's own office.
INSERT INTO "Document" (
  id, "organizationId", category, classification, "fileName", "storageRef",
  "versionNumber", "uploadedByUserId", "deletionLocked", "createdAt"
)
SELECT gen_random_uuid(),
       b."organizationId",
       'BROKER_LICENSE_CERTIFICATE',
       'INTERNAL',
       'no-certificate-on-record--term-predates-module-0-item-c.txt',
       'absent:no-certificate-was-captured-for-this-term',
       1,
       -- Attributed to the office's earliest user, because `uploadedByUserId` is NOT NULL and no
       -- real uploader exists for a backfilled row. Not a claim that this person filed anything.
       (SELECT u.id FROM "User" u WHERE u."organizationId" = b."organizationId" ORDER BY u."createdAt" ASC, u.id ASC LIMIT 1),
       TRUE,
       now()
  FROM "BrokerLicense" b
 WHERE b."certificateDocumentId" IS NULL;

-- Point each term at the certificate just created for it. Matched on the office, which is
-- unambiguous because exactly one such Document was inserted per term above.
UPDATE "BrokerLicense" b
   SET "certificateDocumentId" = d.id
  FROM "Document" d
 WHERE d."organizationId" = b."organizationId"
   AND d.category = 'BROKER_LICENSE_CERTIFICATE'
   AND d."storageRef" = 'absent:no-certificate-was-captured-for-this-term'
   AND b."certificateDocumentId" IS NULL;

ALTER TABLE "BrokerLicense" ALTER COLUMN "certificateDocumentId" SET NOT NULL;

ALTER TABLE "BrokerLicense"
  ADD CONSTRAINT "BrokerLicense_certificateDocumentId_fkey"
  FOREIGN KEY ("certificateDocumentId") REFERENCES "Document"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retire the singleton id. A term's primary key is now a uuid like every other row's.
UPDATE "BrokerLicense" SET id = gen_random_uuid() WHERE id = 'the-broker-license';

CREATE UNIQUE INDEX "BrokerLicense_organizationId_licenseNumber_expiresAt_key"
  ON "BrokerLicense" ("organizationId", "licenseNumber", "expiresAt");
CREATE INDEX "BrokerLicense_organizationId_expiresAt_idx"
  ON "BrokerLicense" ("organizationId", "expiresAt" DESC);

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  singleton_rows BIGINT;
  no_cert        BIGINT;
  bad_office     BIGINT;
  total          BIGINT;
  fk_action      "char";
  is_not_null    BOOLEAN;
BEGIN
  -- 1. THE SINGLETON ID IS GONE. The whole point of the migration; asserted first.
  SELECT count(*) INTO singleton_rows FROM "BrokerLicense" WHERE id = 'the-broker-license';
  IF singleton_rows <> 0 THEN
    RAISE EXCEPTION 'broker licence terms: % row(s) still carry the singleton id', singleton_rows;
  END IF;

  -- 2. Every term has a certificate, and the column cannot go back to nullable unnoticed.
  SELECT a.attnotnull INTO is_not_null
    FROM pg_attribute a
   WHERE a.attrelid = '"BrokerLicense"'::regclass AND a.attname = 'certificateDocumentId'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF NOT is_not_null THEN
    RAISE EXCEPTION 'broker licence terms: certificateDocumentId is nullable — the certificate is not mandatory';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE "certificateDocumentId" IS NULL)
    INTO total, no_cert FROM "BrokerLicense";
  IF no_cert <> 0 THEN
    RAISE EXCEPTION 'broker licence terms: % term(s) have no certificate', no_cert;
  END IF;

  -- 3. The FK is RESTRICT, not the SetNull Prisma defaults an optional relation to. A certificate
  --    that can be deleted out from under its term is evidence that can be deleted out from under
  --    its term — and `db:divergence` has been bitten by exactly this default before.
  SELECT c.confdeltype INTO fk_action
    FROM pg_constraint c
   WHERE c.conrelid = '"BrokerLicense"'::regclass
     AND c.conname  = 'BrokerLicense_certificateDocumentId_fkey';
  IF fk_action IS NULL THEN
    RAISE EXCEPTION 'broker licence terms: the certificate foreign key does not exist';
  END IF;
  IF fk_action <> 'r' THEN
    RAISE EXCEPTION 'broker licence terms: the certificate FK is ON DELETE %, expected RESTRICT (r)', fk_action;
  END IF;

  -- 4. NO TERM CHANGED OFFICE. The pre-existing row keeps the organization it already had, and
  --    this is what would catch a backfill that moved one — including the failure mode of
  --    pointing a term at a certificate belonging to a different office.
  SELECT count(*) INTO bad_office
    FROM "BrokerLicense" b JOIN "Document" d ON d.id = b."certificateDocumentId"
   WHERE d."organizationId" <> b."organizationId";
  IF bad_office <> 0 THEN
    RAISE EXCEPTION 'broker licence terms: % term(s) point at a certificate belonging to another office', bad_office;
  END IF;

  RAISE NOTICE 'broker licence terms: % term(s); singleton id retired, every term has an office-matched certificate.', total;
END $$;
