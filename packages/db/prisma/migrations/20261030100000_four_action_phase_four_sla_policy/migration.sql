-- Four-action permissions, PHASE 4 (second umbrella) — SLA policies, and the holiday calendar with them.
--
-- The owner ruled on the two candidates Phase 4's measurement left open:
--
--   * `sla.policy.manage` — SPLIT. Routine, because `sla.policy.regulatory` already stands apart for the
--     decision that actually carries weight on this surface: whether an SLA is a STATUTORY deadline or an
--     internal target. Splitting the CRUD verbs takes nothing away from that distinction.
--   * `user.manage` — DO NOT SPLIT. It anchors the last-administrator lockout guard at four routes, and
--     that guard exists because an office which loses every administrator cannot repair itself from inside
--     the system. See IMPROVEMENTS § 3.15 for the ruling and, more importantly, for the ORDER if it is ever
--     revisited: the lockout guard is re-proven first, and the split follows. Never the reverse.
--
-- FOUR CODES, NOT THREE — BECAUSE THE UMBRELLA GATED TWO ENTITIES
-- ---------------------------------------------------------------
-- `sla.policy.manage` gated five routes across two controllers, and the fifth is not an SLA policy at all:
-- `POST /sla/holidays` adds a public holiday to the business-day calendar. Mapping that onto
-- `sla.policy.create` would be a lie about what the code gates — the same reason four-action Phase 1 split
-- `insurer.relationship.manage` into FIVE codes rather than pretending an insurance LINE was an insurer.
--
-- The two jobs are genuinely different. A holiday is clerical and factual: Eid falls on these dates. An SLA
-- duration is a policy decision with regulatory weight. An office can reasonably let somebody maintain the
-- calendar without letting them change a statutory deadline, and after this it can.
--
-- `sla.policy.read` ALREADY EXISTS and is the fourth action of the policy set — held by five roles rather
-- than the umbrella's three, deliberately, and untouched here. The holiday READ stays on it too: there is no
-- separate `sla.holiday.read`, because viewing the calendar is part of understanding how an SLA is computed,
-- and a code nothing needs is worse than a shared one.
--
-- ACTIVATE AND DEACTIVATE ARE ONE CODE
-- -----------------------------------
-- `POST /:id/activate` and `POST /:id/deactivate` both go to `sla.policy.deactivate`, which is the house
-- pattern: `insurer.deactivate` is "stop and resume dealing with an insurer" and `role.deactivate` is
-- "retire a role, reactivate a retired one". Turning a switch off and back on is one capability.
--
-- NOBODY LOSES A CAPABILITY
-- ------------------------
-- The umbrella is held by COMPLIANCE, MANAGER and EXEC; all four successors go to every role holding it,
-- including an office's own custom roles that `seed.ts` knows nothing about. The assertion below proves it
-- before anything is deleted.

-- ---------------------------------------------------------------------------
-- 1. The new codes.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES
  (gen_random_uuid(), 'sla.policy.create', 'sla', 'Create an SLA policy — its duration, calendar and escalation stages'),
  (gen_random_uuid(), 'sla.policy.update', 'sla', 'Correct an SLA policy''s duration, calendar or escalation stages'),
  (gen_random_uuid(), 'sla.policy.deactivate', 'sla', 'Switch an SLA policy off so it stops applying, and switch a dormant one back on'),
  (gen_random_uuid(), 'sla.holiday.create', 'sla', 'Add a public holiday to the business-day calendar every SLA deadline is counted against')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Expand every grant of the umbrella into its successors.
-- ---------------------------------------------------------------------------
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", successor."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN (
  VALUES
    ('sla.policy.manage', 'sla.policy.create'),
    ('sla.policy.manage', 'sla.policy.update'),
    ('sla.policy.manage', 'sla.policy.deactivate'),
    ('sla.policy.manage', 'sla.holiday.create')
) AS expansion("source", "successor") ON expansion."source" = source."code"
JOIN "Permission" successor ON successor."code" = expansion."successor"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Prove it, while the umbrella is still there to compare against.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing integer;
  sources integer;
  expanded integer;
BEGIN
  CREATE TEMP TABLE expansion("source" text, "successor" text) ON COMMIT DROP;
  INSERT INTO expansion VALUES
    ('sla.policy.manage', 'sla.policy.create'),
    ('sla.policy.manage', 'sla.policy.update'),
    ('sla.policy.manage', 'sla.policy.deactivate'),
    ('sla.policy.manage', 'sla.holiday.create');

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
      'four-action phase 4 (sla): % (role, successor) grants were owed and not written. A role would have lost the ability to configure an SLA, so nothing is applied.',
      missing;
  END IF;

  -- "It did something WHEN THERE WAS SOMETHING TO DO" — not "it did something". The sibling migration
  -- 20261029100000 got that wrong and could not run on an empty database: `migrate deploy` runs before
  -- `seed.ts`, so a database built from nothing has no grants to expand and the successors arrive later from
  -- the seeded catalogue. CI builds from nothing and caught it; both local databases were already seeded and
  -- could not. So the comparison is against the SOURCE count, readable because the umbrella is not deleted
  -- until step 4.
  SELECT count(*) INTO sources
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  JOIN expansion e ON e."source" = p."code";

  SELECT count(*) INTO expanded
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  JOIN expansion e ON e."successor" = p."code";

  IF sources > 0 AND expanded = 0 THEN
    RAISE EXCEPTION
      'four-action phase 4 (sla): % umbrella grant(s) exist and NO successor grant was written. The expansion matched nothing; a silent no-op is refused.',
      sources;
  END IF;
  RAISE NOTICE
    'four-action phase 4 (sla): % umbrella grant(s) seen, % successor grants now held', sources, expanded;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The umbrella goes. Grants first — `RolePermission.permissionId` has no cascade.
-- ---------------------------------------------------------------------------
DELETE FROM "RolePermission"
WHERE "permissionId" IN (
  SELECT "id" FROM "Permission" WHERE "code" = 'sla.policy.manage'
);

DELETE FROM "Permission" WHERE "code" = 'sla.policy.manage';

DO $$
DECLARE leftovers integer;
BEGIN
  SELECT count(*) INTO leftovers FROM "Permission" WHERE "code" = 'sla.policy.manage';
  IF leftovers > 0 THEN
    RAISE EXCEPTION 'four-action phase 4 (sla): the umbrella survived the delete';
  END IF;
END $$;
