-- ============================================================================
-- Office-scoped custom roles — Phase 1
--
-- Replaces the fixed, globally-shared 11-role catalogue with per-office custom
-- roles. Authorization stops resolving by role NAME and starts resolving by
-- role ID; this migration is the schema half of that change.
--
-- ---------------------------------------------------------------------------
-- WHY THE NAME -> ID CHANGE IS A SECURITY FIX, NOT A REFACTOR
-- ---------------------------------------------------------------------------
-- `Role.name` was globally UNIQUE, so `where: { role: { name: { in: roles } } }`
-- could only ever match one office's row and the permission cache could safely
-- key on names. Both assumptions die here: once two offices can each define a
-- role called "Manager", a name-keyed lookup returns BOTH offices' rows and the
-- caller receives the union of their grants. `PermissionRepository` and
-- `PermissionsService` move to ids in the same change for exactly this reason.
--
-- ---------------------------------------------------------------------------
-- HOW EXISTING ROWS ARE PRESERVED — ADOPTION, NOT WHOLESALE DUPLICATION
-- ---------------------------------------------------------------------------
-- The 11 Role rows are shared by every office today. Rather than create 11 new
-- rows per office and orphan the originals, each legacy row is ADOPTED by one
-- organization (the lowest organizationId among those actually using it) and
-- COPIED for every other organization that uses it.
--
-- Consequences, all deliberate:
--   * The adopting office's UserRoleAssignment rows never move at all — the
--     ids they already point at simply gain an organizationId. Less to go
--     wrong, and nothing to repoint.
--   * Only offices that genuinely use a role get a copy of it. Per the
--     approved decision, an office is NOT seeded with roles it never used:
--     `demo-office-b` has no Data Protection Officer, Executive Management or
--     External Auditor row after this runs, because it has no such assignment.
--   * No row is deleted. Rollback is "delete the copies, repoint, drop the
--     columns" — the adopted rows are the originals, ids intact.
--
-- A legacy role used by NO organization is adopted by the lowest-id
-- organization so the NOT NULL can be satisfied without discarding its
-- permission grid. It becomes an ordinary unused role that an administrator
-- can delete through the Role screen. (No such row exists today — all 11 are
-- in use — but the migration must not depend on that.)
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
-- The `RoleName` enum TYPE is kept, not dropped. Nothing references it after
-- this migration, but role-name string literals still exist in application
-- code until Phase 2 converts them, and the approved plan defers dropping the
-- type by at least one release so rollback stays cheap.
--
-- `status`, `isSystem`, `descriptionAr`/`descriptionEn` and the
-- OFFICE_ADMINISTRATOR bootstrap role are Phase 3 — they are consumed by the
-- Role CRUD screen, which does not exist yet. Adding dormant columns here
-- would put schema in front of the behaviour that justifies it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns, nullable for now so existing rows survive the ALTER.
-- ---------------------------------------------------------------------------
ALTER TABLE "Role" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Role" ADD COLUMN "nameAr" TEXT;
ALTER TABLE "Role" ADD COLUMN "nameEn" TEXT;

-- ---------------------------------------------------------------------------
-- 2. `name` stops being an enum. USING makes the cast explicit; Postgres will
--    not coerce an enum to text implicitly in an ALTER ... TYPE.
-- ---------------------------------------------------------------------------
ALTER TABLE "Role" ALTER COLUMN "name" TYPE TEXT USING "name"::TEXT;

-- The global unique goes NOW, before step 5 inserts the per-office copies —
-- a copy shares its source's name by definition, so the old constraint
-- rejects the very first one. (It did, on the first run of this migration:
-- "duplicate key value violates unique constraint Role_name_key". The whole
-- migration is one transaction, so that attempt rolled back intact.) The
-- composite unique that replaces it cannot be created until step 4 has given
-- every row an organizationId, so the table is briefly unconstrained on name
-- — inside this transaction, invisible to anything else.
DROP INDEX IF EXISTS "Role_name_key";

-- ---------------------------------------------------------------------------
-- 3. Display names for the 11 legacy roles, lifted verbatim from the web
--    dictionary (apps/web/lib/i18n/translations/enums.ts) so the names an
--    office already sees on screen do not change under it.
--
--    Applied BEFORE the copies are made, so every copy inherits them.
-- ---------------------------------------------------------------------------
UPDATE "Role" SET "nameEn" = 'Sales / Relationship Officer',      "nameAr" = 'موظف المبيعات وعلاقات العملاء' WHERE "name" = 'SALES_RELATIONSHIP_OFFICER';
UPDATE "Role" SET "nameEn" = 'Placement / Technical Officer',     "nameAr" = 'موظف الاكتتاب والتنسيب'         WHERE "name" = 'PLACEMENT_TECHNICAL_OFFICER';
UPDATE "Role" SET "nameEn" = 'Policy Checking Officer',           "nameAr" = 'موظف تدقيق الوثائق'            WHERE "name" = 'POLICY_CHECKING_OFFICER';
UPDATE "Role" SET "nameEn" = 'Claims Officer',                    "nameAr" = 'موظف المطالبات'                WHERE "name" = 'CLAIMS_OFFICER';
UPDATE "Role" SET "nameEn" = 'Finance / Collections Officer',     "nameAr" = 'موظف المالية والتحصيل'         WHERE "name" = 'FINANCE_COLLECTIONS_OFFICER';
UPDATE "Role" SET "nameEn" = 'Compliance Officer',                "nameAr" = 'موظف الالتزام'                 WHERE "name" = 'COMPLIANCE_OFFICER';
UPDATE "Role" SET "nameEn" = 'Data Protection Officer',           "nameAr" = 'مسؤول حماية البيانات'          WHERE "name" = 'DATA_PROTECTION_OFFICER';
UPDATE "Role" SET "nameEn" = 'Branch / Department Manager',       "nameAr" = 'مدير الفرع أو القسم'           WHERE "name" = 'BRANCH_DEPARTMENT_MANAGER';
UPDATE "Role" SET "nameEn" = 'Executive Management',              "nameAr" = 'الإدارة التنفيذية'             WHERE "name" = 'EXECUTIVE_MANAGEMENT';
UPDATE "Role" SET "nameEn" = 'System / Security Administrator',   "nameAr" = 'مدير النظام والأمن'            WHERE "name" = 'SYSTEM_SECURITY_ADMINISTRATOR';
UPDATE "Role" SET "nameEn" = 'External Auditor',                  "nameAr" = 'مدقق خارجي'                    WHERE "name" = 'EXTERNAL_AUDITOR';

-- Any role this migration does not know by name (there are none today) still
-- needs non-null display names to satisfy the NOT NULL below. Falling back to
-- the machine name is honest: it is what an administrator would see anyway.
UPDATE "Role" SET "nameEn" = "name" WHERE "nameEn" IS NULL;
UPDATE "Role" SET "nameAr" = "name" WHERE "nameAr" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. ADOPTION — each legacy role joins the lowest-id organization that uses
--    it, falling back to the lowest-id organization overall when unused.
--
--    Every assignment counts here, revoked ones included: a revoked grant is
--    the audit record that access WAS held, and it must keep resolving to a
--    role row or that history becomes unreadable.
-- ---------------------------------------------------------------------------
UPDATE "Role" r
SET "organizationId" = COALESCE(
  (SELECT MIN(a."organizationId") FROM "UserRoleAssignment" a WHERE a."roleId" = r.id),
  (SELECT MIN(o.id) FROM "Organization" o)
);

-- ---------------------------------------------------------------------------
-- 5. COPIES — one per (organization, role) pair that the adoption above did
--    not already cover. `gen_random_uuid()` is pgcrypto, available by default
--    on PostgreSQL 13+.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE "_role_copy_map" (
  "legacyRoleId"   TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "newRoleId"      TEXT NOT NULL
);

INSERT INTO "_role_copy_map" ("legacyRoleId", "organizationId", "newRoleId")
SELECT DISTINCT a."roleId", a."organizationId", gen_random_uuid()::TEXT
FROM "UserRoleAssignment" a
JOIN "Role" r ON r.id = a."roleId"
WHERE a."organizationId" <> r."organizationId";

INSERT INTO "Role" (id, "organizationId", name, "nameAr", "nameEn", description, "createdAt")
SELECT m."newRoleId", m."organizationId", r.name, r."nameAr", r."nameEn", r.description, r."createdAt"
FROM "_role_copy_map" m
JOIN "Role" r ON r.id = m."legacyRoleId";

-- Each copy gets the SAME permission grid as the role it came from. This is
-- what makes the migration access-neutral: a user's effective permissions are
-- identical before and after, which `role-migration.integration.spec.ts`
-- asserts per user, per organization.
INSERT INTO "RolePermission" (id, "roleId", "permissionId")
SELECT gen_random_uuid()::TEXT, m."newRoleId", rp."permissionId"
FROM "_role_copy_map" m
JOIN "RolePermission" rp ON rp."roleId" = m."legacyRoleId";

-- Repoint only the assignments belonging to a copying organization. The
-- adopting organization's rows are deliberately untouched.
UPDATE "UserRoleAssignment" a
SET "roleId" = m."newRoleId"
FROM "_role_copy_map" m
WHERE a."roleId" = m."legacyRoleId"
  AND a."organizationId" = m."organizationId";

DROP TABLE "_role_copy_map";

-- ---------------------------------------------------------------------------
-- 6. Constraints — only now that every row carries an organization.
-- ---------------------------------------------------------------------------
ALTER TABLE "Role" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Role" ALTER COLUMN "nameAr" SET NOT NULL;
ALTER TABLE "Role" ALTER COLUMN "nameEn" SET NOT NULL;

ALTER TABLE "Role"
  ADD CONSTRAINT "Role_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The replacement for the global unique dropped in step 2: a role name is
-- unique WITHIN an office and nowhere else. That single-tenant assumption is
-- the whole reason this change exists.
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

-- `organizationId` is stamped by tenantScopeExtension on every write. The
-- default mirrors every other tenant-scoped table so a raw INSERT that forgets
-- it fails loudly instead of silently landing in the wrong office.
ALTER TABLE "Role"
  ALTER COLUMN "organizationId"
  SET DEFAULT current_setting('app.current_org_id', true);

-- ---------------------------------------------------------------------------
-- 7. RLS catch-up — layer 2 for the two tables that never had it.
--
-- Role is straightforward: it now carries organizationId, same policy shape as
-- the other 119 tables.
--
-- RolePermission has no organizationId of its own and deliberately does not
-- get one — a denormalized copy could drift from Role.organizationId, and the
-- drifted row would be the one granting access. It is scoped through its Role
-- instead. The EXISTS subquery reads "Role", which is itself now RLS-protected,
-- so the two layers compose rather than one undoing the other.
--
-- Same fail-closed property as every other policy here: current_setting(...)
-- returns NULL when unset, `= NULL` is NULL rather than true, so a connection
-- that never sets the variable sees no rows at all.
-- ---------------------------------------------------------------------------
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "Role"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "RolePermission"
  USING (EXISTS (
    SELECT 1 FROM "Role" r
    WHERE r.id = "RolePermission"."roleId"
      AND r."organizationId" = current_setting('app.current_org_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Role" r
    WHERE r.id = "RolePermission"."roleId"
      AND r."organizationId" = current_setting('app.current_org_id', true)
  ));

-- `Permission` stays GLOBAL and un-policied on purpose: it is the catalogue of
-- what the software can do, identical for every office, and the role screen in
-- every office must be able to read all of it. Only the GRANTS are per-office.
