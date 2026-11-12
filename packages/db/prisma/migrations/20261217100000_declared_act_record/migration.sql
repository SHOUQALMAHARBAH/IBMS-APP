-- MODULE 1 — THE DECLARED-ACT RECORD. The office was warned, declared, and proceeded.
--
-- OWNER DECISION 126: the system warns and records and does not refuse, except for four acts whose
-- harm is irreversible AND falls on someone other than the office. This table is the *records*
-- half, and it is GENERAL FROM THE FIRST LINE because decision 126 names SEVEN sites
-- (`docs/modules/module-01-declared-action-and-legal-values.md` §٨.٢), not one. Wiring the first
-- of them (art. 15/d) is message 36 §4; this migration is the record itself.
--
-- The model comment in `schema.prisma` carries the FOUR measured reasons this is a new table
-- rather than `CombinedDutyAct` extended, and maps each of the nine elements to its column.
--
-- ## THE NINE ELEMENTS ARE BUILT WHOLE OR NOT AT ALL (§٨.١), and eight of the nine land here:
--
--   1 the article TEXT verbatim as displayed       -> "articleTextShown"
--   2 a written reason with a minimum length       -> "reason" + CHECK, floor of TEN
--   3 a separate permission per site               -> "permissionCode" + "site"
--   4 the acknowledgement STORED AS SHOWN          -> "acknowledgementTextShown"
--   5 event, article, reason, name, timestamp,
--     permission, related record                   -> every column below
--   6 responsibility as a SENTENCE                 -> "responsibilitySentence"
--   7 append-only, under every permission          -> the two triggers at the end
--   9 the developer release AND ITS LIMIT          -> "acknowledgementTextShown" (see the note)
--
-- Element 8 — detailed in the office's compliance report, an AGGREGATE NUMBER ONLY at the provider
-- — is a reporting surface and message 36 §3 is server-and-database only. The columns support both
-- readings: `(organizationId, site)` is indexed for the aggregate, and `(entity, entityId)` for the
-- detail shown on the record.
--
-- ## 🔴 WHY ELEMENT 9 IS *NOT* A CHECK CONSTRAINT — measured, and it is a finding rather than a
-- ## shortcut.
--
-- Element 9 requires the developing company's release in the acknowledgement box AND its limit
-- beside it, never separated. The obvious enforcement is a CHECK that the stored text contains
-- both phrases. MEASURED on 2026-11-12 against the adviser's own drafted acknowledgements in
-- `docs/answers/legal-counsel-{five,six}-items-verbatim.md`:
--
--   art. 15/d      contains «إبراء ذمة الشركة المطورة»      -> satisfies element 9
--   art. 19/أ/3    does NOT contain any release clause       -> would be REFUSED by such a CHECK
--   art. 16/ي/8    does NOT contain any release clause       -> would be REFUSED by such a CHECK
--
-- So a blanket CHECK would refuse the adviser's own text for two of the seven sites, and that text
-- is his, not ours to edit. The gap is REPORTED to the owner instead: either those two
-- acknowledgements gain the clause, or element 9 is art-15/d-specific. Until she rules, the CHECK
-- here enforces what is true of all seven — the acknowledgement is PRESENT and is not the word
-- «yes», which is the adviser's own requirement — and the composed art. 15/d string is pinned
-- byte-for-byte by a test, where the release and its limit are one string and cannot be separated.
--
-- NO BACK-FILL AND NOTHING REINTERPRETED: the table is new and asserted EMPTY below.

CREATE TYPE "DeclaredActSite" AS ENUM (
  'ARTICLE_15_D_FEWER_THAN_THREE_INSURERS',
  'ARTICLE_19_A_3_UNPAID_PREMIUM_AS_DEBT',
  'ARTICLE_16_Y_8_PROHIBITED_PREMIUM_COLLECTION',
  'PRACTISING_AFTER_AUTHORISATION_WITHDRAWN',
  'STAFF_BELOW_MINIMUM_AT_ISSUANCE',
  'OFFICE_MANAGER_HOLDS_DATA_PROTECTION',
  'ONE_PERSON_FOR_LIFE_AND_GENERAL'
);

CREATE TABLE "DeclaredAct" (
  "id"                       TEXT NOT NULL,
  -- The same `DEFAULT current_setting('app.current_org_id', true)` every tenant-scoped table here
  -- carries. NOT NULL: unlike `LegalValue`, there is no such thing as a provider-owned declaration
  -- — a declared act is always an office's act.
  "organizationId"           TEXT NOT NULL DEFAULT current_setting('app.current_org_id', true),
  "site"                     "DeclaredActSite" NOT NULL,
  "articleRef"               TEXT NOT NULL,
  "articleTextShown"         TEXT NOT NULL,
  "acknowledgementTextShown" TEXT NOT NULL,
  "responsibilitySentence"   TEXT NOT NULL,
  "reason"                   TEXT NOT NULL,
  "permissionCode"           TEXT NOT NULL,
  "entity"                   TEXT NOT NULL,
  "entityId"                 TEXT NOT NULL,
  "transactionRef"           TEXT NOT NULL,
  "actorUserId"              TEXT NOT NULL,
  "actorNameShown"           TEXT NOT NULL,
  "actedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- The adviser's «وعنوانُ الشبكة». NULLABLE: a request can genuinely arrive without a resolvable
  -- address, and a column that lies about having one is worse than one that admits it does not.
  -- Message 35 §4.1 is explicit that this does NOT go on `AuditLogEntry`.
  "networkAddress"           TEXT,

  CONSTRAINT "DeclaredAct_pkey" PRIMARY KEY ("id")
);

-- ON DELETE RESTRICT, deliberately. A declared act is the evidence an inspector asks for; an office
-- row whose deletion silently took its declarations with it would destroy exactly that. The same
-- reasoning `db:divergence` caught on `LegalValue`'s FK, where Prisma's default for an optional
-- relation would have been SET NULL.
ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A PLAIN actor FK and NOT a composite `(actorUserId, organizationId)` tenant FK, with the reason
-- stated because the repository's pattern elsewhere is the composite one: `User` carries no
-- `@@unique([id, organizationId])`, which such an FK requires, and `CombinedDutyAct` — the sibling
-- act table, with the same actor relation — does not have one either. Adding that unique to `User`
-- is a change to a central table and belongs to a decision of its own. THE GAP IS NAMED: nothing
-- at the database level stops a row naming another office's user. In the application it cannot
-- happen — `organizationId` comes from the session GUC and the actor from `@CurrentUser()`, which
-- `JwtStrategy` resolves inside that same session's organization — so this is one defence rather
-- than two, and that is recorded rather than implied.

CREATE INDEX "DeclaredAct_organizationId_actedAt_idx" ON "DeclaredAct"("organizationId", "actedAt" DESC);
CREATE INDEX "DeclaredAct_organizationId_site_idx" ON "DeclaredAct"("organizationId", "site");
CREATE INDEX "DeclaredAct_entity_entityId_idx" ON "DeclaredAct"("entity", "entityId");
CREATE INDEX "DeclaredAct_actorUserId_idx" ON "DeclaredAct"("actorUserId");

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE CHECKS. The nine elements in the one place a caller cannot forget them.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ELEMENT 2 — the written reason, with THE ONE SHARED FLOOR. Ten characters, the same number
-- `common/declaration-reason.ts` holds and two other SQL CHECKs already enforce where no importer
-- can reach. OWNER DECISION 87 set FIFTEEN and the owner STRUCK it on that point on 2026-11-11
-- (decision 129 §5, «خليها 10 عادي ما بتضر»), so ten is the floor everywhere.
--
-- ⛔ The adviser's drafted window still prints «حد أدنى 15 حرفاً» as the field's hint. That string
-- is his and is not corrected in place — `docs/answers/` is a source transcription — but it must
-- NOT ship as a label while this CHECK enforces ten, because the label would then be false. It is
-- in message 36 §6's table for the owner.
ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_reason_meets_the_shared_floor"
  CHECK (length(btrim("reason")) >= 10);

-- ELEMENTS 1, 4 and 6 — the three stored texts are PRESENT and are PROSE, not a token. The
-- adviser's own requirement is «النصُّ الحرفيُّ للإقرارِ والسببِ لا كلمةُ «نعم»» — the verbatim
-- text of the acknowledgement and the reason, NOT the word «yes» — so a floor that a tick or a
-- three-letter token cannot clear is the enforceable half of that sentence.
--
-- ONE NUMBER FOR ALL THREE, and `check:declaration-floor` is why. Its first version used 40 for
-- the two long texts and 20 for the responsibility sentence, and that gate refused it: a length
-- floor in SQL that is not the shared declaration floor «is a second number for a different
-- concept and needs its own home». It was right, and TWO numbers for ONE concept was worse than
-- it looked — the responsibility sentence is 32 characters, so 40 would have refused the owner's
-- own sentence the day somebody applied the longer floor to it by symmetry.
--
-- So the concept has one home: `DECLARED_ACT_SHOWN_TEXT_MIN_LENGTH` in
-- `apps/api/src/modules/compliance-risk/declared-act.config.ts`, declared in that gate's
-- `OTHER_LENGTH_FLOORS` with this reason. It is deliberately NOT the declaration floor of ten:
-- these are not reasons somebody wrote, they are statutory text the system displayed, and ten
-- characters of article text would be a different defect entirely.
-- THREE CONSTRAINTS AND NOT ONE WITH THREE CONDITIONS, and `check:declaration-floor` is why
-- again: its SQL reader attributes one column per CHECK, so a single constraint naming three
-- columns was visible to it as ONE floor and the other two read as declared-but-absent. Rather
-- than widen that reader, the constraints are split — which is better regardless, because a
-- failure now names WHICH text was too short instead of saying one of three was.
ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_articleTextShown_is_prose"
  CHECK (length(btrim("articleTextShown")) >= 20);

ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_acknowledgementTextShown_is_prose"
  CHECK (length(btrim("acknowledgementTextShown")) >= 20);

ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_responsibilitySentence_is_prose"
  CHECK (length(btrim("responsibilitySentence")) >= 20);

-- ELEMENTS 3 and 5 — every identifying field carries something. A declaration that cannot say
-- which permission was used, which record it belongs to, or which transaction it was part of is
-- not evidence of anything, and the adviser asked for the transaction number by name.
ALTER TABLE "DeclaredAct"
  ADD CONSTRAINT "DeclaredAct_identifies_what_it_declares"
  CHECK (
    btrim("articleRef") <> ''
    AND btrim("permissionCode") <> ''
    AND btrim("entity") <> ''
    AND btrim("entityId") <> ''
    AND btrim("transactionRef") <> ''
    AND btrim("actorNameShown") <> ''
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY. ENABLED **AND FORCED**: one office must never read another's declarations,
-- and FORCE is what makes that true of the table's owner too. Only `LegalValue` was forced before
-- this; measured on 2026-11-11, every other tenant table is ENABLE-only, so its owner is exempt.
-- A legal record of an admitted regulatory breach is exactly the wrong place to leave that open.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE "DeclaredAct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeclaredAct" FORCE ROW LEVEL SECURITY;

-- Fail-closed: `current_setting(..., true)` is NULL when unset, and `col = NULL` is NULL and never
-- true — so a connection with no tenant context sees nothing rather than everything.
CREATE POLICY "DeclaredAct_tenant_isolation" ON "DeclaredAct"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ELEMENT 7 — APPEND ONLY, UNDER EVERY PERMISSION. «السجلُّ إضافةٌ فقط: لا يُحذَف ولا يُعدَّل
-- بأيِّ صلاحية.»
--
-- A permission cannot express this, which is the point: any permission model that can grant
-- "edit" can be configured to grant it. Copied from `AuditLogEntry`'s pair
-- (`audit_log_entry_no_update` / `..._no_delete`) and `RetentionArchiveRetrieval`'s, each of which
-- has its own function so the message names its own table.
--
-- UPDATE would let somebody rewrite the reason or the acknowledgement they claimed to have read;
-- DELETE would let them remove the record of having declared at all. Both are the whole value of
-- the record.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION prevent_declared_act_mutation() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'DeclaredAct rows are append-only — a declared act is a fact that occurred and the record testifies to what the person saw, so % is not permitted by any permission (module-1 paper element 7)', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER declared_act_no_update
  BEFORE UPDATE ON "DeclaredAct"
  FOR EACH ROW EXECUTE FUNCTION prevent_declared_act_mutation();

CREATE TRIGGER declared_act_no_delete
  BEFORE DELETE ON "DeclaredAct"
  FOR EACH ROW EXECUTE FUNCTION prevent_declared_act_mutation();

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS. The migration proves what it just built, so a silent partial apply cannot pass.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  n INT;
BEGIN
  -- 1. The table is EMPTY. There is no back-fill and nothing has been reinterpreted.
  SELECT count(*) INTO n FROM "DeclaredAct";
  IF n <> 0 THEN
    RAISE EXCEPTION 'declared-act record: expected an empty table, found % row(s) — something back-filled it', n;
  END IF;

  -- 2. The enum holds decision 126's seven sites and no eighth.
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'DeclaredActSite';
  IF n <> 7 THEN
    RAISE EXCEPTION 'declared-act record: DeclaredActSite holds % members, expected decision 126s seven', n;
  END IF;

  -- 3. RLS is ENABLED **and FORCED**. Enabled alone exempts the owner, which for this table would
  --    mean the one connection that can read every office's admitted breaches is exempt.
  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'DeclaredAct' AND relrowsecurity AND relforcerowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'declared-act record: row-level security is not both ENABLED and FORCED';
  END IF;

  -- 4. The tenant policy exists.
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'DeclaredAct' AND policyname = 'DeclaredAct_tenant_isolation';
  IF n <> 1 THEN
    RAISE EXCEPTION 'declared-act record: the tenant isolation policy is missing';
  END IF;

  -- 5. BOTH append-only triggers. One of the two is the hole: no-update without no-delete leaves
  --    the record deletable, and the reverse leaves it rewritable.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = '"DeclaredAct"'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'declared-act record: expected 2 append-only triggers, found %', n;
  END IF;

  -- 6. The three CHECKs are present and the reason floor really is TEN, read from the constraint's
  --    own definition rather than trusted to this file having written it.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"DeclaredAct"'::regclass AND contype = 'c'
     AND conname IN (
       'DeclaredAct_reason_meets_the_shared_floor',
       'DeclaredAct_articleTextShown_is_prose',
       'DeclaredAct_acknowledgementTextShown_is_prose',
       'DeclaredAct_responsibilitySentence_is_prose',
       'DeclaredAct_identifies_what_it_declares'
     );
  IF n <> 5 THEN
    RAISE EXCEPTION 'declared-act record: expected 5 named CHECK constraints, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"DeclaredAct"'::regclass
     AND conname = 'DeclaredAct_reason_meets_the_shared_floor'
     AND position('10' IN pg_get_constraintdef(oid)) > 0;
  IF n <> 1 THEN
    RAISE EXCEPTION 'declared-act record: the reason floor is no longer the shared TEN — read it in pg_get_constraintdef and update `common/declaration-reason.ts` in the same commit';
  END IF;

  -- 7. The actor FK restricts rather than cascading or nulling. A deleted user must not be able to
  --    take the declaration with them, and SET NULL would leave an act nobody made.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = '"DeclaredAct"'::regclass AND contype = 'f' AND confdeltype = 'r';
  IF n <> 2 THEN
    RAISE EXCEPTION 'declared-act record: expected both foreign keys to be ON DELETE RESTRICT, found % restricting', n;
  END IF;
END $$;
