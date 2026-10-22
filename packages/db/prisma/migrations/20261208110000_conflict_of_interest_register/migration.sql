-- MODULE 0-ب — THE CONFLICT-OF-INTEREST DISCLOSURE REGISTER (decision 36).
--
-- ## THE NAME `ConflictOfInterestDisclosure` IS ALREADY TAKEN, BY SOMETHING THIS IS NOT
--
-- Measured before writing anything, because the near-neighbour trap is how `refund.raise` came to be
-- recorded as a maker code that reads no route. `ConflictOfInterestDisclosure` EXISTS and is LIVE,
-- and it is a different object on all three axes that matter:
--
--   * ITS SUBJECT IS A RECOMMENDATION, not a person — `recommendationId` is `@unique`, one per
--     recommendation.
--   * IT IS DETECTED, not declared — `Recommendation.conflictOfInterestFlagged` is a snapshot taken
--     at draft time by a commission heuristic (a comparable competing quote carrying a materially
--     lower commission rate), and the row records the competing quotation and the commission
--     difference.
--   * ITS ACTOR MUST DIFFER FROM THE MAKER — `acknowledgedByUserId` must not be the
--     recommendation's `draftedByUserId`, because the conflicted officer cannot clear their own
--     conflict.
--
-- Decision 36's register is the OPPOSITE on every one of those: a PERSON records their OWN conflict,
-- there is no detection and no trigger, and the discloser IS the subject. Reusing that model would
-- have put two unrelated meanings in one table and made the per-recommendation commission control
-- unreadable. So this is a new table with a name that cannot be confused with it.
--
-- ## WHY DISCLOSING ABOUT YOURSELF IS NOT A PERMISSION
--
-- The discloser is the subject. That is the same reasoning that leaves `AccessRecertificationItem`'s
-- maker permission empty — no permission exists for it, or CAN — and it is why `POST` on this
-- register is gated by authentication alone. A permission to declare your own conflict would be a
-- permission an office could withhold, and withholding it would mean the person with the conflict is
-- the one person unable to say so.
--
-- READING the register IS a permission: `conflict-of-interest.register.read`, granted by the office
-- to whoever it chooses, with the manager role as the SHIPPED TEMPLATE DEFAULT rather than a fixed
-- holder (decision 80 — the template is not a lock).
--
-- ## APPEND-ONLY BY TRIGGER, NOT BY GRANT
--
-- `pg_default_acl` carries `ibms` granting `ibms_app=arwd/ibms` on every new table in this schema, so
-- a narrower GRANT restricts nothing — measured when `RetentionArchiveRetrieval` asserted its own
-- privilege set and failed, naming `DELETE,INSERT,SELECT,UPDATE`. The house mechanism is the
-- `AuditLogEntry` trigger pair, copied rather than re-invented so the message names this table.
--
-- The argument is stronger here than for a retrieval: UPDATE would let somebody rewrite what they
-- declared, and DELETE would let them UN-DECLARE. A correction is a NEW entry, which is how
-- `RegulatoryAction` and `Quotation` already behave — two statements are two facts.

CREATE TABLE "ConflictOfInterestRegisterEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL DEFAULT (current_setting('app.current_org_id', true)),

  -- THE SUBJECT AND THE AUTHOR ARE ONE PERSON, which is the whole shape of this register. There is
  -- deliberately no second actor column: nothing here is approved, countersigned or cleared.
  "declaredByUserId" TEXT NOT NULL,

  -- FREE TEXT, and no `nature` enum beside it. What KINDS of conflict an office recognises is not
  -- decided anywhere in this product, and shipping a closed list would make the register refuse the
  -- conflict nobody anticipated — the invented-vocabulary class. The application floor is the shared
  -- declaration minimum in `common/declaration-reason.ts`.
  "disclosure" TEXT NOT NULL,

  "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConflictOfInterestRegisterEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ConflictOfInterestRegisterEntry"
  ADD CONSTRAINT "ConflictOfInterestRegisterEntry_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- `onDelete: RESTRICT` EXPLICITLY. Prisma's default for a relation it reads as optional is
-- `SetNull`, and a disclosure nobody is recorded as having made is the one thing a register of
-- self-declarations cannot hold.
ALTER TABLE "ConflictOfInterestRegisterEntry"
  ADD CONSTRAINT "ConflictOfInterestRegisterEntry_declaredByUserId_fkey"
  FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ConflictOfInterestRegisterEntry_organizationId_idx"
  ON "ConflictOfInterestRegisterEntry"("organizationId");
-- The register's own read: this office's disclosures, newest first.
CREATE INDEX "ConflictOfInterestRegisterEntry_register_idx"
  ON "ConflictOfInterestRegisterEntry"("organizationId", "declaredAt" DESC);
CREATE INDEX "ConflictOfInterestRegisterEntry_declaredByUserId_idx"
  ON "ConflictOfInterestRegisterEntry"("declaredByUserId");

ALTER TABLE "ConflictOfInterestRegisterEntry"
  ADD CONSTRAINT "ConflictOfInterestRegisterEntry_disclosure_not_blank"
  CHECK (length(btrim("disclosure")) > 0);

ALTER TABLE "ConflictOfInterestRegisterEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConflictOfInterestRegisterEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ConflictOfInterestRegisterEntry_tenant_isolation" ON "ConflictOfInterestRegisterEntry"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "ConflictOfInterestRegisterEntry" TO ibms_app;

CREATE FUNCTION prevent_conflict_of_interest_register_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'ConflictOfInterestRegisterEntry rows are immutable — a disclosure is a statement somebody made, a correction is a NEW entry, and % is not permitted', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER conflict_of_interest_register_no_update
  BEFORE UPDATE ON "ConflictOfInterestRegisterEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_conflict_of_interest_register_mutation();

CREATE TRIGGER conflict_of_interest_register_no_delete
  BEFORE DELETE ON "ConflictOfInterestRegisterEntry"
  FOR EACH ROW EXECUTE FUNCTION prevent_conflict_of_interest_register_mutation();

DO $$
DECLARE
  rls BOOLEAN;
  forced BOOLEAN;
  policies INTEGER;
  blank_def TEXT;
  trigger_events TEXT[];
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO rls, forced
  FROM pg_class WHERE oid = '"ConflictOfInterestRegisterEntry"'::regclass;
  IF NOT rls THEN
    RAISE EXCEPTION 'row level security is not ENABLEd';
  END IF;
  -- FORCE is asserted separately: without it the table OWNER is exempt from its own policy, which is
  -- how an unfiltered cross-office read once returned 13,774 rows with every assertion green.
  IF NOT forced THEN
    RAISE EXCEPTION 'row level security is not FORCEd';
  END IF;

  SELECT count(*) INTO policies
  FROM pg_policies
  WHERE tablename = 'ConflictOfInterestRegisterEntry';
  IF policies <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 tenant-isolation policy, found %', policies;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO blank_def
  FROM pg_constraint
  WHERE conname = 'ConflictOfInterestRegisterEntry_disclosure_not_blank';
  IF blank_def IS NULL OR blank_def NOT LIKE '%btrim%' THEN
    RAISE EXCEPTION 'the not-blank CHECK is missing or no longer trims — it reads %', blank_def;
  END IF;

  -- BOTH TRIGGERS, ASSERTED BY EVENT rather than by name. A pair renamed still refuses; a pair that
  -- covers only UPDATE leaves the row deletable, which is the half that lets somebody un-declare.
  SELECT array_agg(DISTINCT lower(em.event)) INTO trigger_events
  FROM pg_trigger tg
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN (tg.tgtype & 16) <> 0 THEN 'update'
      WHEN (tg.tgtype & 8) <> 0 THEN 'delete'
      ELSE 'other'
    END AS event
  ) em
  WHERE tg.tgrelid = '"ConflictOfInterestRegisterEntry"'::regclass
    AND NOT tg.tgisinternal;
  IF trigger_events IS NULL
     OR NOT ('update' = ANY(trigger_events))
     OR NOT ('delete' = ANY(trigger_events)) THEN
    RAISE EXCEPTION 'the immutability triggers do not cover both UPDATE and DELETE — found %', trigger_events;
  END IF;

  RAISE NOTICE 'conflict-of-interest register created; RLS enabled and forced, 1 policy, immutable on UPDATE and DELETE';
END $$;
