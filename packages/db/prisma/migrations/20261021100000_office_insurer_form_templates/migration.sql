-- Q9 — an office's OWN insurer form, for the company only it deals with.
--
-- ============================================================================
-- WHY THIS IS A SECOND MODEL AND NOT A COLUMN ON THE FIRST
-- ============================================================================
--
-- IMPROVEMENTS.md § 1.26 predicted that Q9 would make `InsurerFormTemplate` office-scoped:
-- add `organizationId`, make `insurerMasterId` nullable, take both line FKs, delete
-- `assertGlobalLine`. Re-derived here rather than followed, which is what that entry asked
-- for — and re-deriving produced a DIFFERENT answer.
--
-- `InsurerFormTemplate` is global ON PURPOSE. It hangs off `InsurerMaster`, so a mapping made
-- once by whichever office first dealt with a company is immediately readable by every other
-- office, unmodified. That is Part I § 5's promise and a Part V multi-tenancy checklist item:
-- two offices must never each re-map the same objectively-identical PDF and drift into two
-- divergent copies of one document.
--
-- **Adding `organizationId` to that table would silently withdraw that promise.**
-- `applyTenantScope` adds `where: { organizationId }` to every query on any model carrying the
-- column — the scoped set is DERIVED from the DMMF, so there is no third state. A row visible
-- to every office and a table the extension scopes are mutually exclusive, and the only way to
-- have both is to special-case the one mechanism that protects ~100 other tables.
--
-- So the split is the same one that already exists ONE LEVEL UP, and for the same reason:
--
--     InsurerMaster  (global)    -> InsurerFormTemplate        shared, catalogue lines only
--     Insurer        (office)    -> OfficeInsurerFormTemplate  this office only, either line
--
-- `Insurer` already carries a nullable `insurerMasterId`: a row linked to the catalogue, or a
-- company this office registered itself. Hanging the office template off `Insurer` therefore
-- needs no `insurerMasterId` at all — which is how the gap Q9 exists to close disappears
-- rather than being patched. On the global table `insurerMasterId` stays NOT NULL, where it is
-- correct, and `assertGlobalLine` stays with it, because its stated precondition ("the model is
-- GLOBAL") is still true of that model.
--
-- Measured before choosing: `InsurerFormTemplate` holds 0 rows on dev and 0 on db-test, so
-- neither shape had a data-migration cost today. That is exactly why the decision was worth
-- making now — both are free before any office has mapped a form, and only one of them stays
-- free afterwards.
--
-- ============================================================================
-- WHAT A ROW MEANS, AND THE ONE THING IT MUST NOT BE
-- ============================================================================
--
-- An office contracts with a company outside the platform. That company sends THAT OFFICE its
-- forms. The administrator uploads and field-maps them. They are never shared with another
-- office — so this table is tenant-scoped like every other office record, with RLS and the
-- composite FKs that make a cross-office reference fail to INSERT rather than merely be
-- filtered out.
--
-- It is NOT a private edit of a shared mapping. Nothing here writes, versions or supersedes an
-- `InsurerFormTemplate` row. An office that thinks the shared mapping is wrong for a
-- catalogue company can record its own here and it takes precedence FOR THAT OFFICE ONLY; the
-- shared row other offices submit against is untouched and unaware.

-- ---------------------------------------------------------------------------
-- 1. The template.
-- ---------------------------------------------------------------------------
CREATE TABLE "OfficeInsurerFormTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  -- The office's OWN insurer row, which is what makes this office-scoped rather than a
  -- second opinion about a global company. Works identically for a catalogue-linked
  -- insurer and a locally registered one, because `Insurer.insurerMasterId` is nullable.
  "insurerId" TEXT NOT NULL,
  -- Either catalogue line or the office's own addition. BOTH nullable, exactly one set —
  -- the § 1.26 prediction that survived re-derivation, and it survived for the reason the
  -- entry gave: once the child carries an `organizationId`, an office's own line becomes a
  -- LEGITIMATE referent. An office that added "Pet" and holds that insurer's Pet form is
  -- precisely the case Q9 serves, and on a row no other office can read there is nothing
  -- to disclose.
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "sourceDocumentRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Stored, unlike the global table, which records its author only in the audit log. A
  -- form this office submits against is operational data its own administrator owns, and
  -- "who mapped this" is the first question asked when a submission is rejected.
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "OfficeInsurerFormTemplate_pkey" PRIMARY KEY ("id")
);

-- EXACTLY one referent, the same shape `InsurerOfferedLine` uses: a row pointing at both
-- has two answers to "which line is this", and a row pointing at neither is a form for a
-- line nothing names.
ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_exactly_one_line"
  CHECK (num_nonnulls("insuranceLineId", "officeInsuranceLineId") = 1);

-- ---------------------------------------------------------------------------
-- 2. One version per line per insurer, expressed the way the sibling table expresses it.
-- ---------------------------------------------------------------------------
-- TWO uniques over the nullable columns, relying on Postgres treating NULLs as distinct —
-- the identical shape `InsurerOfferedLine` has used since it was built.
--
-- I first wrote a `GENERATED` `lineKey` (COALESCE of the two) here instead, on the argument
-- that adding a `version` to the key makes the two-index shape unsafe: two rows with the same
-- insurer, the same office line and version 1 differ only in a NULL `insuranceLineId`, and
-- under NULL-distinctness both would insert. **Measured, and the argument is false.** A temp
-- table with exactly those two indexes refused the second row:
--
--     ERROR: duplicate key value violates unique constraint
--            "shape_without_generated_key_insurerId_officeInsuranceLineId_idx"
--
-- The `exactly_one_line` CHECK is what makes it safe: every row has exactly one non-null line
-- column, so every row is constrained by exactly one of the two indexes, and the index it
-- lands in is the one whose column is NOT null. The generated column bought nothing, and cost
-- a database feature `schema.prisma` cannot express plus another `db:divergence` allow-list
-- entry. Both of these uniques ARE expressible, so the schema declares them and the gate stays
-- silent.
CREATE UNIQUE INDEX "OfficeInsurerFormTemplate_insurerId_insuranceLineId_version_key"
  ON "OfficeInsurerFormTemplate" ("insurerId", "insuranceLineId", "version");
CREATE UNIQUE INDEX "OfficeInsurerFormTemplate_insurerId_officeLineId_version_key"
  ON "OfficeInsurerFormTemplate" ("insurerId", "officeInsuranceLineId", "version");

-- Resolving "which form do I submit against" — newest version for one insurer and one line.
-- Two indexes rather than one over a derived key, for the same reason: the service resolves
-- the line id against its own table BEFORE it queries, because it has to validate it either
-- way, so it always knows which column to filter on. The branch is free.
CREATE INDEX "OfficeInsurerFormTemplate_resolve_standard_idx"
  ON "OfficeInsurerFormTemplate"
     ("organizationId", "insurerId", "insuranceLineId", "version" DESC);
CREATE INDEX "OfficeInsurerFormTemplate_resolve_office_idx"
  ON "OfficeInsurerFormTemplate"
     ("organizationId", "insurerId", "officeInsuranceLineId", "version" DESC);
CREATE INDEX "OfficeInsurerFormTemplate_organizationId_idx"
  ON "OfficeInsurerFormTemplate" ("organizationId");
-- The target of the field table's composite FK below.
CREATE UNIQUE INDEX "OfficeInsurerFormTemplate_id_organizationId_key"
  ON "OfficeInsurerFormTemplate" ("id", "organizationId");

-- ---------------------------------------------------------------------------
-- 3. The FKs. Simple ones because Prisma declares the relations; composite ones because
--    the simple ones do not carry tenancy.
-- ---------------------------------------------------------------------------
-- Both, on every office-scoped parent, for the reason `20261019110000` had to be written:
-- the simple FK is what Prisma's client and referential actions are built against, and
-- declaring a relation without it is a schema divergence; the composite FK is the tenancy
-- guarantee, and it is what makes a row referencing ANOTHER office's insurer or line fail
-- to INSERT rather than merely be filtered out by a query nobody audited.
ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_insurerId_fkey"
  FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_insurer_same_org_fkey"
  FOREIGN KEY ("insurerId", "organizationId")
  REFERENCES "Insurer"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeInsurerFormTemplate"
  ADD CONSTRAINT "OfficeInsurerFormTemplate_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeInsurerFormTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OfficeInsurerFormTemplate"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- 4. The fields, which carry `organizationId` for a reason worth stating.
-- ---------------------------------------------------------------------------
-- The global `InsurerFormField` has no `organizationId` because its parent has none, and
-- Phase 1 of the RBAC work learned what happens when a child is left without one: an RLS
-- policy scoped through a JOIN to its parent can NEVER be satisfied, because
-- `tenantScopeExtension` sets `app.current_org_id` only for models that CARRY the column.
-- Every permission read returned empty and users authenticated fine then 403'd everywhere.
--
-- So this child denormalizes it, and the drift that invites is answered structurally: the
-- composite FK `(templateId, organizationId)` makes a field claiming a different office
-- than its template fail to INSERT.
CREATE TABLE "OfficeInsurerFormField" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "labelEn" TEXT NOT NULL,
  "labelAr" TEXT,
  "dataType" "InsurerFormFieldType" NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "options" TEXT[],
  "displayOrder" INTEGER NOT NULL,
  CONSTRAINT "OfficeInsurerFormField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficeInsurerFormField_templateId_fieldKey_key"
  ON "OfficeInsurerFormField" ("templateId", "fieldKey");
CREATE INDEX "OfficeInsurerFormField_templateId_idx"
  ON "OfficeInsurerFormField" ("templateId");
CREATE INDEX "OfficeInsurerFormField_organizationId_idx"
  ON "OfficeInsurerFormField" ("organizationId");

ALTER TABLE "OfficeInsurerFormField"
  ADD CONSTRAINT "OfficeInsurerFormField_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE, matching the global table: a field has no meaning without its template, and a
-- re-map creates a new version rather than deleting an old one, so this fires only when a
-- template is genuinely removed.
ALTER TABLE "OfficeInsurerFormField"
  ADD CONSTRAINT "OfficeInsurerFormField_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OfficeInsurerFormTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfficeInsurerFormField"
  ADD CONSTRAINT "OfficeInsurerFormField_template_same_org_fkey"
  FOREIGN KEY ("templateId", "organizationId")
  REFERENCES "OfficeInsurerFormTemplate"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OfficeInsurerFormField" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OfficeInsurerFormField"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- 5. Verify, on the database being deployed to.
-- ---------------------------------------------------------------------------
-- Every property below is one `db:divergence` cannot see — it reports neither CHECK
-- constraints nor partial indexes, measured this week — or one no gate covers at all, like
-- RLS being ENABLED. A property nobody asserts is a property a later migration can drop
-- while every gate stays green.
DO $assert$
DECLARE
  t        text;
  missing  text;
BEGIN
  FOREACH t IN ARRAY ARRAY['OfficeInsurerFormTemplate', 'OfficeInsurerFormField'] LOOP
    -- RLS. Without this the tenant extension's `where` clause is the ONLY thing separating
    -- two offices' forms, and the extension is application code that a raw query bypasses.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity
    ) THEN
      RAISE EXCEPTION '% does not have row-level security ENABLED. Its tenant policy would be decoration.', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
    ) THEN
      RAISE EXCEPTION '% has RLS enabled but no tenant_isolation policy, which denies everything instead of isolating anything.', t;
    END IF;
  END LOOP;

  -- The CHECK, invisible to db:divergence.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'OfficeInsurerFormTemplate_exactly_one_line' AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'OfficeInsurerFormTemplate_exactly_one_line is missing. A template could name both lines or neither.';
  END IF;

  -- BOTH uniques. They look like one constraint written twice, which is exactly how a later
  -- "tidy up the duplicate index" removes the half that constrains office-added lines —
  -- and `db:divergence` would not notice, because it reports neither of these shapes.
  SELECT string_agg(name, ', ') INTO missing
    FROM (VALUES
      ('OfficeInsurerFormTemplate_insurerId_insuranceLineId_version_key'),
      ('OfficeInsurerFormTemplate_insurerId_officeLineId_version_key')
    ) AS want(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = want.name AND i.indisunique
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Unique index/indexes missing: %. Each constrains one KIND of line; with either gone an office could hold two version-1 forms for one line.', missing;
  END IF;

  -- Every composite tenant FK. These are the constraints that make a cross-office
  -- reference impossible rather than merely filtered, and each one reads like a
  -- duplicate of the simple FK beside it — which is exactly how one gets tidied away.
  SELECT string_agg(name, ', ') INTO missing
    FROM (VALUES
      ('OfficeInsurerFormTemplate_insurer_same_org_fkey'),
      ('OfficeInsurerFormTemplate_office_line_same_org_fkey'),
      ('OfficeInsurerFormField_template_same_org_fkey')
    ) AS want(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = want.name AND contype = 'f'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Composite tenant FK(s) missing: %. Without them a row can reference another office''s insurer or line and the reference is structurally valid.', missing;
  END IF;
END
$assert$;
