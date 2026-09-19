-- ============================================================================
-- RolePermission becomes tenant-scoped — the correction migration
-- 20261003100000 owed.
--
-- ---------------------------------------------------------------------------
-- WHAT THE PREVIOUS MIGRATION GOT WRONG, AND HOW IT SHOWED UP
-- ---------------------------------------------------------------------------
-- It put an RLS policy on `RolePermission` that scopes through a join to
-- `Role`, specifically to AVOID denormalizing `organizationId` onto a second
-- table where a drifted copy could become the row that grants access.
--
-- That policy can never be satisfied. `tenantScopeExtension` sets the
-- `app.current_org_id` session variable only for models it treats as
-- tenant-scoped — and its definition of tenant-scoped is "carries an
-- organizationId column", derived from the DMMF. `RolePermission` had none, so
-- the extension classified it global, skipped the `set_config`, and the policy's
-- `current_setting('app.current_org_id', true)` was NULL on every read.
--
-- Result: `findCodesForRoles` returned zero rows for everybody. Every user
-- authenticated normally, `/auth/me` listed their roles correctly, and their
-- permissions came back as an empty array — so every guarded endpoint 403'd.
-- Caught by `tenant-isolation.e2e-spec.ts` failing in `beforeAll` on a 403
-- where it expected a 201, then narrowed with a throwaway diagnostic spec that
-- printed `roles: ["SALES_RELATIONSHIP_OFFICER"]` beside `permissions: 0`.
--
-- It failed CLOSED, which is the only reason this is a bug report and not an
-- incident. An RLS policy on a table the extension does not scope is not
-- "defence in depth" — it is an outage waiting for a deploy.
--
-- ---------------------------------------------------------------------------
-- WHY DENORMALIZING IS NOW SAFE
-- ---------------------------------------------------------------------------
-- The original objection stands on its own terms: two copies of the same fact
-- can disagree, and here the disagreeing copy would decide who can do what. So
-- the invariant is enforced by the database rather than by reviewers
-- remembering it — a composite foreign key from `(roleId, organizationId)` to
-- `Role(id, organizationId)`. A grant whose organization differs from its
-- role's does not violate a convention; it fails to INSERT.
--
-- That is strictly stronger than the join-based policy this replaces, and it
-- costs one unique index on a table with 19 rows.
--
-- `tenant-scope.extension.ts` is NOT touched by any of this — adding the column
-- is what brings the model under Layer 1, because the scoped set is derived
-- from the schema. That file stays on the protected list.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The unique target the composite foreign key needs. `id` alone is already
--    unique; Postgres still requires a unique index on exactly the referenced
--    column pair.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "Role_id_organizationId_key" ON "Role"("id", "organizationId");

-- ---------------------------------------------------------------------------
-- 2. The column, backfilled from the role each grant already points at — so
--    the pair agrees by construction before the constraint starts enforcing it.
-- ---------------------------------------------------------------------------
ALTER TABLE "RolePermission" ADD COLUMN "organizationId" TEXT;

UPDATE "RolePermission" rp
SET "organizationId" = r."organizationId"
FROM "Role" r
WHERE r.id = rp."roleId";

ALTER TABLE "RolePermission" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "RolePermission"
  ADD CONSTRAINT "RolePermission_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The constraint that makes the denormalization honest: a grant cannot name an
-- Organization its own role does not belong to.
ALTER TABLE "RolePermission"
  ADD CONSTRAINT "RolePermission_role_organization_agree_fkey"
  FOREIGN KEY ("roleId", "organizationId") REFERENCES "Role"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "RolePermission_organizationId_idx" ON "RolePermission"("organizationId");

-- Stamped by tenantScopeExtension on every write; the default mirrors every
-- other tenant-scoped table so a raw INSERT that forgets it fails loudly rather
-- than landing in the wrong office.
ALTER TABLE "RolePermission"
  ALTER COLUMN "organizationId"
  SET DEFAULT current_setting('app.current_org_id', true);

-- ---------------------------------------------------------------------------
-- 3. Replace the unsatisfiable join policy with the same plain, fail-closed
--    shape every other tenant-scoped table uses. RLS stays ENABLED throughout;
--    only the policy changes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_isolation" ON "RolePermission";
CREATE POLICY "tenant_isolation" ON "RolePermission"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));
