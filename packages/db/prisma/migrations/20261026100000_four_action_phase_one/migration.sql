-- Four-action permissions, PHASE 1 — split four umbrellas, and close two ride-alongs.
--
-- The owner's scheme is that view / create / edit / deactivate are four separate permissions, so a role
-- can be given one without the others. Phase 1 does the part where the capability ALREADY EXISTS: four
-- umbrella codes become their successors, and two actions that rode on a neighbouring code get their own.
--
-- NOBODY LOSES A CAPABILITY
-- -------------------------
-- Every role holding an umbrella receives ALL of its successors — including an office's own custom roles,
-- which the seed knows nothing about. That is the whole reason this is a migration and not a seed change:
-- `seed.ts` upserts the grid it declares and has never removed a grant (migration 20261004120000 records
-- that lesson), and it cannot grant to a role it did not create.
--
-- The expansion is driven by a table of (source, successor) pairs and asserted BEFORE anything is
-- deleted: if any role that held a source is missing any successor, this migration raises and rolls back.
--
-- WHY THE SETS ARE NOT ALL FOUR
-- -----------------------------
-- `document.manage` becomes TWO codes. No route edits a document in place — a change is a new version,
-- which is a create — and deletion already has `document.delete-override`. Declaring `document.update`
-- and `document.deactivate` for symmetry would add two codes nothing can exercise, which reads as a
-- capability that exists and is worse than the umbrella was.
--
-- `insurer.relationship.manage` becomes FIVE. It gated two different entities — the office's insurer
-- records and the insurance LINES they carry — and mapping a line onto "update an insurer" would be a
-- lie about what the code gates.
--
-- `role.read` and `insurer.read` already existed and are the fourth action of their sets.
--
-- THE TWO RIDE-ALONGS
-- -------------------
-- `PATCH /needs-assessments/:id` was gated by `needs-assessment.create`, and every risk-profile asset
-- route by `risk-profile.create` — so correcting a record required the permission to raise one. Those two
-- sources are KEPT (they still gate their own create); the successors are added beside them, to exactly
-- the roles that hold the create today, so re-gating the routes takes nothing away.

-- ---------------------------------------------------------------------------
-- 1. The new codes.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES
  (gen_random_uuid(), 'vendor.read', 'supporting-operations', 'View the vendor register, a vendor''s record, and its data-share readiness'),
  (gen_random_uuid(), 'vendor.create', 'supporting-operations', 'Register a vendor'),
  (gen_random_uuid(), 'vendor.update', 'supporting-operations', 'Correct a vendor record, set its risk tier, record an annual review, raise and sign a data-processing agreement'),
  (gen_random_uuid(), 'vendor.deactivate', 'supporting-operations', 'Terminate a vendor and revoke its access'),
  (gen_random_uuid(), 'document.read', 'supporting-operations', 'View the document register, a document, and the classification summary'),
  (gen_random_uuid(), 'document.create', 'supporting-operations', 'Upload a document and add a new version of one'),
  (gen_random_uuid(), 'role.create', 'admin', 'Define a new role in this office''s catalogue'),
  (gen_random_uuid(), 'role.update', 'admin', 'Rename a role, change what it grants, and set its MFA attributes (behind a step-up challenge)'),
  (gen_random_uuid(), 'role.deactivate', 'admin', 'Retire a role, reactivate a retired one, and delete one that was never used'),
  (gen_random_uuid(), 'insurer.create', 'insurance-operations', 'Register an insurer for this office, whether it is in the global catalogue or in none'),
  (gen_random_uuid(), 'insurer.update', 'insurance-operations', 'Maintain this office''s own record of an insurer and its relationship terms'),
  (gen_random_uuid(), 'insurer.deactivate', 'insurance-operations', 'Stop and resume dealing with an insurer, and read the live impact of doing so'),
  (gen_random_uuid(), 'insurance-line.create', 'insurance-operations', 'Add a line of business to this office''s vocabulary'),
  (gen_random_uuid(), 'insurance-line.update', 'insurance-operations', 'Correct a line of business this office added'),
  (gen_random_uuid(), 'needs-assessment.update', 'commercial-front-office', 'Correct a needs assessment before it is submitted'),
  (gen_random_uuid(), 'risk-profile.update', 'commercial-front-office', 'Add, correct and remove the insured assets on a risk profile')
ON CONFLICT ("code") DO NOTHING;

-- The module for the two ride-along codes was first written as `sales-crm`, a module no other code uses,
-- while their siblings live in `commercial-front-office`. A permission's module is what groups it on the Role
-- matrix screen, so one lone module renders as an extra group holding two rows — visibly wrong on the
-- screen the scheme exists for. Corrected as its own statement because the INSERT above cannot: it is
-- ON CONFLICT DO NOTHING, so it would leave an already-created row alone.
UPDATE "Permission" SET "module" = 'commercial-front-office'
WHERE "code" IN ('needs-assessment.update', 'risk-profile.update');

-- ---------------------------------------------------------------------------
-- 2. Expand every grant of a source code into its successors.
-- ---------------------------------------------------------------------------
-- `organizationId` and `roleId` are copied from the row being expanded, so the composite FK
-- `(roleId, organizationId)` -> `Role(id, organizationId)` holds by construction: a grant cannot end up
-- attached to an office its role does not belong to.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", successor."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN (
  VALUES
    ('vendor.manage', 'vendor.read'),
    ('vendor.manage', 'vendor.create'),
    ('vendor.manage', 'vendor.update'),
    ('vendor.manage', 'vendor.deactivate'),
    ('document.manage', 'document.read'),
    ('document.manage', 'document.create'),
    ('role.manage', 'role.create'),
    ('role.manage', 'role.update'),
    ('role.manage', 'role.deactivate'),
    ('insurer.relationship.manage', 'insurer.create'),
    ('insurer.relationship.manage', 'insurer.update'),
    ('insurer.relationship.manage', 'insurer.deactivate'),
    ('insurer.relationship.manage', 'insurance-line.create'),
    ('insurer.relationship.manage', 'insurance-line.update'),
    ('needs-assessment.create', 'needs-assessment.update'),
    ('risk-profile.create', 'risk-profile.update')
) AS expansion("source", "successor") ON expansion."source" = source."code"
JOIN "Permission" successor ON successor."code" = expansion."successor"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Prove it, while the sources are still there to compare against.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing integer;
  expanded integer;
BEGIN
  CREATE TEMP TABLE expansion("source" text, "successor" text) ON COMMIT DROP;
  INSERT INTO expansion VALUES
    ('vendor.manage', 'vendor.read'),
    ('vendor.manage', 'vendor.create'),
    ('vendor.manage', 'vendor.update'),
    ('vendor.manage', 'vendor.deactivate'),
    ('document.manage', 'document.read'),
    ('document.manage', 'document.create'),
    ('role.manage', 'role.create'),
    ('role.manage', 'role.update'),
    ('role.manage', 'role.deactivate'),
    ('insurer.relationship.manage', 'insurer.create'),
    ('insurer.relationship.manage', 'insurer.update'),
    ('insurer.relationship.manage', 'insurer.deactivate'),
    ('insurer.relationship.manage', 'insurance-line.create'),
    ('insurer.relationship.manage', 'insurance-line.update'),
    ('needs-assessment.create', 'needs-assessment.update'),
    ('risk-profile.create', 'risk-profile.update');

  -- Every (role, successor) pair the expansion owed, that the role does not now hold.
  SELECT count(*) INTO missing
  FROM (
    SELECT rp."roleId", e."successor"
    FROM "RolePermission" rp
    JOIN "Permission" source ON source."id" = rp."permissionId"
    JOIN expansion e ON e."source" = source."code"
  ) owed
  WHERE NOT EXISTS (
    SELECT 1
    FROM "RolePermission" held
    JOIN "Permission" p ON p."id" = held."permissionId"
    WHERE held."roleId" = owed."roleId" AND p."code" = owed."successor"
  );
  IF missing > 0 THEN
    RAISE EXCEPTION
      'four-action phase 1: % (role, successor) grants were owed and not written. A role would have lost a capability, so nothing is applied.',
      missing;
  END IF;

  -- And it did something: a database with the seeded grid has grants to expand. Zero means the join
  -- matched nothing, which on a seeded database means the source codes are already gone — a re-run, or a
  -- rename upstream — and a silent no-op is how a migration ends up trusted for work it never did.
  SELECT count(*) INTO expanded
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  JOIN expansion e ON e."successor" = p."code";
  RAISE NOTICE 'four-action phase 1: % successor grants now held', expanded;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The umbrellas go. Grants first — `RolePermission.permissionId` has no cascade.
-- ---------------------------------------------------------------------------
DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission"
  WHERE "code" IN ('vendor.manage', 'document.manage', 'role.manage', 'insurer.relationship.manage')
);

DELETE FROM "Permission"
WHERE "code" IN ('vendor.manage', 'document.manage', 'role.manage', 'insurer.relationship.manage');

DO $$
DECLARE leftovers integer;
BEGIN
  SELECT count(*) INTO leftovers FROM "Permission"
  WHERE "code" IN ('vendor.manage', 'document.manage', 'role.manage', 'insurer.relationship.manage');
  IF leftovers > 0 THEN
    RAISE EXCEPTION 'four-action phase 1: % umbrella code(s) survived the delete', leftovers;
  END IF;
END $$;
