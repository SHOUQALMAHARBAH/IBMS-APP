-- MODULE 0 CLOSE, batch 5 group 7c — THE ARCHIVED (BLOCKED) STATE'S RETRIEVAL REGISTER.
--
-- ## WHAT THIS TABLE IS, AND WHAT IT DELIBERATELY IS NOT
--
-- The archived state itself has NO TABLE AND NO COLUMN. A record is BLOCKED when its retention
-- period has elapsed and it is neither held nor extended, which is exactly what the notice already
-- computes — so the state is DERIVED, the decision-71 precedent (a licence's standing is derived
-- from its term and never stored, because a stored copy is free to disagree with the dates it came
-- from). Adding an `archivedAt` column would be a second answer to "is this record past its
-- period", and the two would drift the first time a period was edited.
--
-- What needs a row is condition 3: *"Retrievable ONLY on a judicial request or an official CBJ
-- audit — so retrieval takes a recorded basis naming which of the two, and its own permission."*
-- A basis nobody wrote down is not a basis, so the register IS the condition.
--
-- ## THE BASIS IS A CLOSED TWO
--
-- The `RetentionExtensionBasis` precedent one migration earlier: free text may ACCOMPANY a basis
-- and may never BE one. Both bases are external compulsion — a court asked, or the Central Bank
-- asked — and there is no third. An office that retrieves a blocked record for its own purposes is
-- not retrieving it on a basis; it is processing it, which is what condition 1 refuses.
--
-- Neither basis carries a structured reference, and that is measured rather than lazy: this product
-- holds no model for a judicial request and no model for a CBJ audit, so a column pointing at one
-- would be a string-typed instruction nothing checks — the shape `RetentionExtension`'s own CHECKs
-- exist to avoid. The note is NOT NULL instead, and the application's floor is the shared
-- declaration minimum, so "which court, and for what" has to be written down.
--
-- ## `recordId` CARRIES NO FOREIGN KEY, FOR THE SAME REASON AS THE EXTENSION REGISTER
--
-- The four resolvable categories are four different models (`Receipt`, `Remittance`,
-- `CommissionLedgerEntry`, `Settlement`), so a real FK would need four nullable columns and a
-- four-way CHECK. `Customer.ownerUserId` is the precedent for a deliberately unconstrained
-- reference, and its own note records the cost: Postgres will accept any string here.

CREATE TYPE "RetentionArchiveRetrievalBasis" AS ENUM (
  'JUDICIAL_REQUEST',
  'CBJ_AUDIT'
);

CREATE TABLE "RetentionArchiveRetrieval" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT (current_setting('app.current_org_id', true)),

  "recordCategory" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,

  "basis" "RetentionArchiveRetrievalBasis" NOT NULL,
  -- WHO ASKED, AND FOR WHAT. NOT NULL: a retrieval from a legal block has to be justifiable years
  -- later, and the basis alone says only which KIND of compulsion was claimed.
  "note" TEXT NOT NULL,

  "retrievedByUserId" TEXT NOT NULL,
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RetentionArchiveRetrieval_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RetentionArchiveRetrieval"
  ADD CONSTRAINT "RetentionArchiveRetrieval_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- `onDelete: RESTRICT` EXPLICITLY. Prisma's default for a relation it reads as optional is
-- `SetNull`, and a retrieval nobody is recorded as having made is the one thing this register
-- cannot be allowed to hold.
ALTER TABLE "RetentionArchiveRetrieval"
  ADD CONSTRAINT "RetentionArchiveRetrieval_retrievedByUserId_fkey"
  FOREIGN KEY ("retrievedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "RetentionArchiveRetrieval_organizationId_idx"
  ON "RetentionArchiveRetrieval"("organizationId");
-- The register's own read: every retrieval of one record, newest first.
CREATE INDEX "RetentionArchiveRetrieval_lookup_idx"
  ON "RetentionArchiveRetrieval"("organizationId", "recordCategory", "recordId", "retrievedAt" DESC);
CREATE INDEX "RetentionArchiveRetrieval_retrievedByUserId_idx"
  ON "RetentionArchiveRetrieval"("retrievedByUserId");

-- The note is the justification, so a blank one is a row that says nothing. The application's floor
-- is ten characters (the shared declaration minimum in `common/declaration-reason.ts`); the database
-- refuses only the degenerate case, so that no code path present or future can write an empty one.
ALTER TABLE "RetentionArchiveRetrieval"
  ADD CONSTRAINT "RetentionArchiveRetrieval_note_not_blank"
  CHECK (length(btrim("note")) > 0);

ALTER TABLE "RetentionArchiveRetrieval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionArchiveRetrieval" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RetentionArchiveRetrieval_tenant_isolation" ON "RetentionArchiveRetrieval"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "RetentionArchiveRetrieval" TO ibms_app;

-- APPEND-ONLY BY TRIGGER, NOT BY GRANT — AND THE FIRST VERSION OF THIS MIGRATION FOUND OUT WHY.
--
-- It granted `SELECT, INSERT` only and asserted that privilege set, on the reasoning that a role
-- which cannot execute UPDATE is a role no service bug can talk into one. The assertion FAILED on
-- its first run, naming what was actually there: `DELETE,INSERT,SELECT,UPDATE`.
--
-- MEASURED: `pg_default_acl` carries `ibms` granting `ibms_app=arwd/ibms` on every new table in this
-- schema. So a NARROWER GRANT IS A NO-OP — the four privileges arrive with `CREATE TABLE`, and the
-- only way to take two away is an explicit REVOKE. A grant statement that reads as a restriction and
-- restricts nothing is worse than no statement at all, so the grant now matches every other table
-- and says nothing it does not do.
--
-- AND THE HOUSE MECHANISM IS ALREADY HERE: `AuditLogEntry` holds the same four privileges and is
-- immutable by a pair of BEFORE triggers (`audit_log_entry_no_update`, `audit_log_entry_no_delete`),
-- which is what actually refuses a DELETE with "rows are immutable (Part 10.3)". Copied rather than
-- re-invented, with its own function so the message names this table.
--
-- A retrieval is a FACT that occurred: UPDATE would let somebody rewrite the basis they claimed, and
-- DELETE would let them remove the record of having looked.
CREATE FUNCTION prevent_retention_archive_retrieval_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'RetentionArchiveRetrieval rows are immutable — a retrieval from a legal block is a fact that occurred, and % is not permitted', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER retention_archive_retrieval_no_update
  BEFORE UPDATE ON "RetentionArchiveRetrieval"
  FOR EACH ROW EXECUTE FUNCTION prevent_retention_archive_retrieval_mutation();

CREATE TRIGGER retention_archive_retrieval_no_delete
  BEFORE DELETE ON "RetentionArchiveRetrieval"
  FOR EACH ROW EXECUTE FUNCTION prevent_retention_archive_retrieval_mutation();

DO $$
DECLARE
  note_def TEXT;
  rls RECORD;
  labels TEXT;
  privs TEXT;
  trigs TEXT;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO labels
  FROM pg_enum WHERE enumtypid = 'public."RetentionArchiveRetrievalBasis"'::regtype;
  IF labels <> 'JUDICIAL_REQUEST,CBJ_AUDIT' THEN
    RAISE EXCEPTION 'the retrieval basis list is a CLOSED TWO — found %', labels;
  END IF;

  -- Asserted by DEFINITION, not existence: a predicate loosened to `TRUE OR (…)` keeps the
  -- constraint name and refuses nothing (the `broker-kind.e2e-spec.ts` plant).
  SELECT pg_get_constraintdef(oid) INTO note_def
  FROM pg_constraint WHERE conname = 'RetentionArchiveRetrieval_note_not_blank';
  IF note_def IS NULL OR note_def NOT LIKE '%btrim%' THEN
    RAISE EXCEPTION 'the note-not-blank CHECK is missing or no longer trims — it reads %', note_def;
  END IF;

  SELECT relrowsecurity, relforcerowsecurity INTO rls
  FROM pg_class WHERE oid = 'public."RetentionArchiveRetrieval"'::regclass;
  IF NOT rls.relrowsecurity OR NOT rls.relforcerowsecurity THEN
    RAISE EXCEPTION 'RLS must be ENABLEd AND FORCEd — got enable=%, force=%',
      rls.relrowsecurity, rls.relforcerowsecurity;
  END IF;

  -- APPEND-ONLY IS ASSERTED BY THE TRIGGERS, because the grant cannot carry it: this schema's
  -- default privileges hand `ibms_app` all four on every new table, which is what the first run of
  -- this migration discovered when its privilege assertion failed naming `DELETE,INSERT,SELECT,
  -- UPDATE`. Both triggers by name AND their events, so one dropped or re-pointed at INSERT fails
  -- here rather than silently letting a basis be rewritten.
  SELECT string_agg(tgname || ':' || pg_get_triggerdef(oid), ' | ' ORDER BY tgname) INTO trigs
  FROM pg_trigger
  WHERE tgrelid = 'public."RetentionArchiveRetrieval"'::regclass AND NOT tgisinternal;
  IF trigs IS NULL THEN
    RAISE EXCEPTION 'the immutability triggers do not exist — the register is not append-only';
  END IF;
  IF trigs NOT LIKE '%retention_archive_retrieval_no_delete%'
     OR trigs NOT LIKE '%retention_archive_retrieval_no_update%'
     OR trigs NOT LIKE '%BEFORE DELETE%'
     OR trigs NOT LIKE '%BEFORE UPDATE%' THEN
    RAISE EXCEPTION 'the immutability triggers no longer cover BOTH update and delete — they read %', trigs;
  END IF;

  -- And the privilege set is REPORTED rather than asserted, so the next reader sees why the trigger
  -- is the mechanism instead of rediscovering it.
  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) INTO privs
  FROM information_schema.role_table_grants
  WHERE table_name = 'RetentionArchiveRetrieval' AND grantee = 'ibms_app';
  RAISE NOTICE 'ibms_app holds % (default privileges grant all four; the triggers are what refuse)', privs;

  RAISE NOTICE 'retention archive retrieval register: 2 bases, append-only by trigger, RLS enabled and forced';
END $$;
