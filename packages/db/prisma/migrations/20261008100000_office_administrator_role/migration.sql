-- Office-scoped custom RBAC, PHASE 3 workstream D — every existing office gets
-- an OFFICE_ADMINISTRATOR role, and every current administrator gets it in
-- ADDITION to the role they already hold.
--
-- WHY THE ROLE EXISTS
-- ------------------
-- An office that defines its own roles needs its administrator to be an ordinary
-- per-office row. Until now that person had to hold
-- `SYSTEM_SECURITY_ADMINISTRATOR`, one of the fixed eleven this rework is
-- retiring — so "who administers this office" was answered by the platform
-- catalogue rather than by the office.
--
-- WHY THIS IS A ZERO-DELTA CHANGE
-- ------------------------------
-- The 22 codes below are a verified STRICT SUBSET of what
-- `SYSTEM_SECURITY_ADMINISTRATOR` already grants. Handing this role to every
-- existing administrator therefore adds nothing to anybody's effective
-- permissions: the gate is a per-user effective-permission diff before and
-- after, and it must be empty. `permissions.spec.ts` asserts the subset property
-- so it cannot quietly stop holding in a later edit.
--
-- IN ADDITION, NEVER INSTEAD
-- --------------------------
-- No existing `UserRoleAssignment` is revoked or moved. An administrator ends up
-- holding both their converted legacy role and this one. Removing the legacy
-- grant would be a privilege change disguised as a rename, and it would also
-- discard the audit record of what they held — which is the whole reason
-- `UserRoleAssignment.revokedAt` exists rather than a DELETE.
--
-- ISSYSTEM GRANTS NOTHING
-- -----------------------
-- `isSystem = true` protects the row from being renamed, retired or re-granted
-- from the Role screen. Authorization never reads it. This role reaches exactly
-- the 22 codes attached below, the same way every other role reaches its grants.
--
-- IDEMPOTENT
-- ----------
-- Every statement is ON CONFLICT DO NOTHING or NOT EXISTS-guarded, because this
-- runs on every environment and some of them will already have been seeded.

-- 1. The role, one per existing Organization. `organizationId` is named
--    explicitly: a migration runs as the owner outside any request, so the
--    column's `current_setting('app.current_org_id', true)` default is NULL and
--    the composite FK would reject the grants attached in step 2.
INSERT INTO "Role" (
  "id", "organizationId", "name", "nameEn", "nameAr", "description",
  "requiresMfaAlways", "requiresHardwareToken", "status", "isSystem", "createdAt"
)
SELECT
  gen_random_uuid(),
  o."id",
  'OFFICE_ADMINISTRATOR',
  'Office Administrator',
  'مدير المكتب',
  'Provisions users, defines the office''s own roles and their permissions, and manages office security configuration, email integration and the operational registers. Cannot delete business records, touch the global insurer catalogue, review its own access recertification, or reveal a national ID.',
  -- Strict, like every administration role in the catalogue. This one can
  -- provision accounts, which is the capability an attacker wants most.
  TRUE,
  TRUE,
  'ACTIVE',
  TRUE,
  now()
FROM "Organization" o
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- 2. Its 22 grants. Named here rather than derived from
--    `SYSTEM_SECURITY_ADMINISTRATOR`'s row set on purpose: copying whatever that
--    role happens to hold would silently widen this one the next time the seed
--    grants the administrator something new, and the exclusions below are
--    deliberate decisions, not leftovers.
--
--    Deliberately EXCLUDED, all verified present in the grid and withheld:
--      claim.delete, document.delete-override      destructive business actions
--      insurer.form.map                            its effect crosses offices
--      access-recertification.review(.routine)     reviewing your own access
--      employee.national-id.reveal                 Part 10.2 Highly Confidential
--      customer.national-id.reveal                 Part 10.2 Highly Confidential
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), r."organizationId", r."id", p."id"
FROM "Role" r
JOIN "Permission" p
  ON p."code" IN (
    -- user administration
    'user.manage',
    'employee.read',
    'employee.create',
    'employee.update',
    'deprovisioning.execute',
    'training.record',
    -- the RBAC surface this phase builds the screen for
    'role.read',
    'role.manage',
    'permission.read',
    -- office security configuration
    'security-config.read',
    'security-config.manage',
    'encryption-key.read',
    'email.integration.read',
    'email.integration.manage',
    -- operational registers an office administrator keeps
    'customer.bulk-import',
    'audit-log.read',
    'access-recertification.cycle.start',
    'incident.report',
    'incident.contain',
    'information-asset.manage',
    'bcp-dr.manage',
    'vendor.manage'
  )
WHERE r."name" = 'OFFICE_ADMINISTRATOR'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3. Grant it to every ACTIVE user who can already administer users, in their
--    own office. "Can already administer users" is asked as a CAPABILITY —
--    holds a live grant of some role that grants `user.manage` — never by role
--    name, because a name is not an identity once two offices can each define a
--    "Manager". Phase 2 made that the rule everywhere; this migration follows
--    it, which also means an office whose administration sits on a CUSTOM role
--    is handled correctly.
--
--    The NOT EXISTS is on `revokedAt IS NULL` rather than on the row: a user
--    whose administrator grant was deliberately revoked must not have it
--    silently restored, and the partial unique index
--    `UserRoleAssignment_one_active_per_user_role` would reject a second live
--    row anyway.
INSERT INTO "UserRoleAssignment" ("id", "organizationId", "userId", "roleId")
SELECT gen_random_uuid(), admin_role."organizationId", u."id", admin_role."id"
FROM "Role" admin_role
JOIN "User" u
  ON u."organizationId" = admin_role."organizationId"
 AND u."isActive" = TRUE
WHERE admin_role."name" = 'OFFICE_ADMINISTRATOR'
  AND EXISTS (
    SELECT 1
    FROM "UserRoleAssignment" ura
    JOIN "Role" held ON held."id" = ura."roleId" AND held."status" = 'ACTIVE'
    JOIN "RolePermission" rp ON rp."roleId" = held."id"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE ura."userId" = u."id"
      AND ura."revokedAt" IS NULL
      AND p."code" = 'user.manage'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "UserRoleAssignment" existing
    WHERE existing."userId" = u."id"
      AND existing."roleId" = admin_role."id"
      AND existing."revokedAt" IS NULL
  );
