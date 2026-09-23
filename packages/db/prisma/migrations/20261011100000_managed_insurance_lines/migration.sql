-- Insurer management — the managed insurance-line vocabulary, plus the company's
-- structure (conventional / takaful / takaful window).
--
-- A managed list with office-side additions, which is neither free text nor a closed
-- list. Free text means "مركبات", "تأمين مركبات" and "سيارات" are three unrelated
-- values, so directory search fails, a policy's line never matches an insurer's and
-- every report fragments. A closed list means waiting on a release whenever the
-- market invents a product. So:
--
--   * "InsuranceLine"       — the 32 standard lines. GLOBAL, no "organizationId",
--                             and nothing in the application writes it: rows arrive
--                             by seed and change only in a release. That is what
--                             keeps the permission-grid invariant (no code has an
--                             effect outside the granting office) without copying 32
--                             rows into every office, which would recreate the
--                             Phase 2 seed-drift problem where a corrected standard
--                             name never reaches an office holding its own copy.
--   * "OfficeInsuranceLine" — a type an office added itself. Office-scoped exactly
--                             like "Insurer", RLS and all.
--   * "InsurerOfferedLine"  — which lines a registered company offers. The COMPANY
--                             half of the boundary; "InsurerProduct" stays the
--                             RELATIONSHIP half (what THIS office places with them)
--                             and never crosses an office boundary.

CREATE TYPE "InsuranceLineCategory" AS ENUM ('GENERAL', 'LIFE');
CREATE TYPE "InsurerStructure" AS ENUM ('CONVENTIONAL', 'TAKAFUL', 'TAKAFUL_WINDOW');

-- ---------------------------------------------------------------------------
-- The global catalogue.
-- ---------------------------------------------------------------------------
CREATE TABLE "InsuranceLine" (
  "id" TEXT NOT NULL,
  -- Stable machine name, and what the seed upserts on. NOT the uuid: each database
  -- seeds its own rows, so a uuid means something different in each one.
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "category" "InsuranceLineCategory" NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsuranceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InsuranceLine_code_key" ON "InsuranceLine"("code");
CREATE INDEX "InsuranceLine_category_displayOrder_idx"
  ON "InsuranceLine"("category", "displayOrder");

-- No RLS: this table carries no "organizationId", so a policy reading
-- `app.current_org_id` would match nothing forever — the outage Phase 1 documented.
-- It is readable by every office by design and writable by nobody.

-- ---------------------------------------------------------------------------
-- An office's own additions.
-- ---------------------------------------------------------------------------
CREATE TABLE "OfficeInsuranceLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "category" "InsuranceLineCategory" NOT NULL,
  -- `canonicalNameKey()` of each name. Stored, because "once per office" has to be a
  -- unique index and the normaliser is a JS function no SQL expression can call.
  "canonicalEn" TEXT NOT NULL,
  "canonicalAr" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "OfficeInsuranceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfficeInsuranceLine_organizationId_canonicalEn_key"
  ON "OfficeInsuranceLine"("organizationId", "canonicalEn");
CREATE UNIQUE INDEX "OfficeInsuranceLine_organizationId_canonicalAr_key"
  ON "OfficeInsuranceLine"("organizationId", "canonicalAr");
-- The target of "InsurerOfferedLine"'s composite foreign key.
CREATE UNIQUE INDEX "OfficeInsuranceLine_id_organizationId_key"
  ON "OfficeInsuranceLine"("id", "organizationId");
CREATE INDEX "OfficeInsuranceLine_organizationId_idx"
  ON "OfficeInsuranceLine"("organizationId");

ALTER TABLE "OfficeInsuranceLine"
  ADD CONSTRAINT "OfficeInsuranceLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OfficeInsuranceLine"
  ADD CONSTRAINT "OfficeInsuranceLine_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfficeInsuranceLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "OfficeInsuranceLine"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- Which lines a company offers.
-- ---------------------------------------------------------------------------
CREATE TABLE "InsurerOfferedLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "insurerId" TEXT NOT NULL,
  "insuranceLineId" TEXT,
  "officeInsuranceLineId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InsurerOfferedLine_pkey" PRIMARY KEY ("id")
);

-- Once per insurer per line. Both columns are nullable and Postgres treats NULLs as
-- distinct, which is what makes these two uniques correct rather than conflicting:
-- an insurer may hold many rows whose "insuranceLineId" is NULL (its office-added
-- lines) and still not hold the same standard line twice.
CREATE UNIQUE INDEX "InsurerOfferedLine_insurerId_insuranceLineId_key"
  ON "InsurerOfferedLine"("insurerId", "insuranceLineId");
CREATE UNIQUE INDEX "InsurerOfferedLine_insurerId_officeInsuranceLineId_key"
  ON "InsurerOfferedLine"("insurerId", "officeInsuranceLineId");
CREATE INDEX "InsurerOfferedLine_organizationId_idx"
  ON "InsurerOfferedLine"("organizationId");
CREATE INDEX "InsurerOfferedLine_insuranceLineId_idx"
  ON "InsurerOfferedLine"("insuranceLineId");

-- EXACTLY one referent. A row pointing at both would have two answers to "which
-- line is this"; a row pointing at neither is a line nothing names.
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_exactly_one_line"
  CHECK (
    ("insuranceLineId" IS NOT NULL AND "officeInsuranceLineId" IS NULL)
    OR ("insuranceLineId" IS NULL AND "officeInsuranceLineId" IS NOT NULL)
  );

ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_insuranceLineId_fkey"
  FOREIGN KEY ("insuranceLineId") REFERENCES "InsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The single-column insurer/office-line references Prisma models, and the COMPOSITE
-- ones it does not. Phase 1's lesson, applied: this table carries a denormalized
-- "organizationId" because the tenant extension only scopes models that have one, and
-- the drift that denormalizing invites is answered structurally rather than by
-- convention — a row claiming an office its parent does not belong to fails to
-- INSERT.
ALTER TABLE "Insurer"
  ADD CONSTRAINT "Insurer_id_organizationId_key" UNIQUE ("id", "organizationId");
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_insurerId_fkey"
  FOREIGN KEY ("insurerId") REFERENCES "Insurer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_insurer_same_org_fkey"
  FOREIGN KEY ("insurerId", "organizationId")
  REFERENCES "Insurer"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_officeInsuranceLineId_fkey"
  FOREIGN KEY ("officeInsuranceLineId") REFERENCES "OfficeInsuranceLine"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsurerOfferedLine"
  ADD CONSTRAINT "InsurerOfferedLine_office_line_same_org_fkey"
  FOREIGN KEY ("officeInsuranceLineId", "organizationId")
  REFERENCES "OfficeInsuranceLine"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InsurerOfferedLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "InsurerOfferedLine"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- ---------------------------------------------------------------------------
-- The company's structure, and the free-text column this replaces.
-- ---------------------------------------------------------------------------
-- Nullable: every insurer registered before this has no answer, and a DEFAULT of
-- 'CONVENTIONAL' would state a fact nobody checked. The registration DTO requires it,
-- which scopes the requirement to new registrations.
ALTER TABLE "Insurer" ADD COLUMN "structure" "InsurerStructure";

-- "Insurer"."linesOffered" was a TEXT[] of free text added when the master link
-- became nullable, and nothing ever wrote it — 0 rows carry a value on either
-- database, verified before this migration. Dropping it rather than leaving it beside
-- "InsurerOfferedLine" avoids two sources of truth for one fact, and this is the only
-- moment the removal is free.
ALTER TABLE "Insurer" DROP COLUMN "linesOffered";
