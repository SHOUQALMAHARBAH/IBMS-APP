-- Four-action permissions, PHASE 4 — the umbrella that gates where client money is sent.
--
-- Phase 4's brief is "deactivate codes where a real deactivation scenario exists". The measurement that
-- scoped it: 21 `*.manage` codes remain, and SIX of them gate a deactivation alongside a create —
-- `payment-channel.manage`, `sla.policy.manage`, `user.manage`, `email.integration.manage`,
-- `retention-case.manage`, `risk-register.manage`.
--
-- This migration splits ONE of the six, and the reasons the other five are not here matter as much:
--
--   * `retention-case.manage` and `risk-register.manage` gate a `:id/close`. Closing a case is a
--     terminal WORKFLOW state, not the deactivation of a configured entity — the same distinction that
--     keeps `claim.close` its own code rather than a `claim.deactivate`. Splitting those would name the
--     wrong thing.
--   * `email.integration.manage` has NO web caller at all (IMPROVEMENTS § 1.44). Splitting it would add
--     codes nothing can exercise, which is what `permission-enforcement.inventory.spec.ts` now refuses
--     and what four-action Phase 1 already declined to do three times.
--   * `sla.policy.manage` and `user.manage` are real candidates and are deliberately deferred.
--     `user.manage` is the anchor of the last-administrator lockout guard, read at four separate routes
--     into that guard plus the segregation signal; splitting it is a decision about a safety control,
--     not a tidy-up, and it is not made here.
--
-- WHY THIS ONE FIRST: CONSEQUENCE
-- -------------------------------
-- `payment-channel.manage` gates adding a payment channel AND disabling one. A payment channel is where
-- client money is sent. Those are not one capability, and the umbrella's own description already read as
-- three things — "add / disable ... and list it when recording a receipt or remittance".
--
-- NOBODY LOSES A CAPABILITY, AND HERE IT IS PROVABLE RATHER THAN ARGUED
-- --------------------------------------------------------------------
-- All three successors go to every role holding the umbrella, including an office's own custom roles that
-- `seed.ts` knows nothing about — the reason this is a migration and not a seed change. Measured before
-- writing: the umbrella is held by FINANCE alone, and so are `receipt.record` and `remittance.record`,
-- the two actions whose screens need to LIST channels. So no role needed the read and lacked it, and none
-- gains anything. The assertion below is what proves it rather than this comment.
--
-- NO `.update`, DELIBERATELY
-- --------------------------
-- There is no route that edits a payment channel in place — `POST /`, `GET /`, `POST /:id/disable` is the
-- whole controller. Declaring `payment-channel.update` for symmetry would add a code nothing can
-- exercise, which reads as a capability that exists. Phase 1 made that call three times and the
-- enforcement guard now enforces it.

-- ---------------------------------------------------------------------------
-- 1. The new codes.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES
  (gen_random_uuid(), 'payment-channel.read', 'finance', 'List the approved payment channels for a customer or insurer, as needed when recording a receipt or a remittance'),
  (gen_random_uuid(), 'payment-channel.create', 'finance', 'Add a payment channel to the approved list for a customer or insurer'),
  (gen_random_uuid(), 'payment-channel.deactivate', 'finance', 'Disable an approved payment channel so no further money is sent to it')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Expand every grant of the umbrella into its successors.
-- ---------------------------------------------------------------------------
-- `organizationId` and `roleId` are copied from the row being expanded, so the composite FK
-- `(roleId, organizationId)` -> `Role(id, organizationId)` holds by construction.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", successor."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN (
  VALUES
    ('payment-channel.manage', 'payment-channel.read'),
    ('payment-channel.manage', 'payment-channel.create'),
    ('payment-channel.manage', 'payment-channel.deactivate')
) AS expansion("source", "successor") ON expansion."source" = source."code"
JOIN "Permission" successor ON successor."code" = expansion."successor"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Prove it, while the umbrella is still there to compare against.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing integer;
  expanded integer;
BEGIN
  CREATE TEMP TABLE expansion("source" text, "successor" text) ON COMMIT DROP;
  INSERT INTO expansion VALUES
    ('payment-channel.manage', 'payment-channel.read'),
    ('payment-channel.manage', 'payment-channel.create'),
    ('payment-channel.manage', 'payment-channel.deactivate');

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
      'four-action phase 4: % (role, successor) grants were owed and not written. A role would have lost the ability to record a receipt, so nothing is applied.',
      missing;
  END IF;

  -- And it did something. Zero successor grants on a seeded database means the join matched nothing —
  -- a re-run, or a rename upstream — and a silent no-op is how a migration gets trusted for work it
  -- never did.
  SELECT count(*) INTO expanded
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  JOIN expansion e ON e."successor" = p."code";
  IF expanded = 0 THEN
    RAISE EXCEPTION
      'four-action phase 4: no successor grants exist after the expansion. Either the umbrella was already gone or the join matched nothing; a silent no-op is refused.';
  END IF;
  RAISE NOTICE 'four-action phase 4: % successor grants now held', expanded;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The umbrella goes. Grants first — `RolePermission.permissionId` has no cascade.
-- ---------------------------------------------------------------------------
DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission" WHERE "code" = 'payment-channel.manage'
);

DELETE FROM "Permission" WHERE "code" = 'payment-channel.manage';

DO $$
DECLARE leftovers integer;
BEGIN
  SELECT count(*) INTO leftovers FROM "Permission" WHERE "code" = 'payment-channel.manage';
  IF leftovers > 0 THEN
    RAISE EXCEPTION 'four-action phase 4: the umbrella survived the delete';
  END IF;
END $$;
