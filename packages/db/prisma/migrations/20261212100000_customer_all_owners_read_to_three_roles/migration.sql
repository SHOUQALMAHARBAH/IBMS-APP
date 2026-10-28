-- OWNER DECISION 57 — `customer.all-owners.read` reaches CLAIMS_OFFICER,
-- FINANCE_COLLECTIONS_OFFICER and PLACEMENT_TECHNICAL_OFFICER.
--
-- NO PERMISSION IS MINTED. The code exists, is already granted to four roles, and already
-- means exactly this — in the owner's own words on the Role screen:
-- «بدونها يرى الموظف عملاءه هو فقط», *without it the employee sees only their own
-- customers*. Three more roles hold it; the catalogue total does not move.
--
-- WHAT THE SCREEN WAS SAYING, AND WHY IT WAS FALSE
-- -----------------------------------------------
-- `/customers` is gated on `customer.read`, which these three hold, and the list beneath
-- that gate is filtered to the customers the actor OWNS (`customer.service.ts`, through
-- `canReadAllCustomerOwners`). Ownership is creator-assigned and has no transfer path:
-- `customer.create` is SALES_RELATIONSHIP_OFFICER alone, and `customer.bulk-import` is
-- the two administrator roles, whose importer writes `ownerUserId: actorUserId`.
--
-- So NONE of these three could ever own a customer, the filter returned exactly zero rows
-- permanently and by construction, and the screen rendered «لا يوجد عملاء بعد» — *there
-- are no customers yet* — which is a false statement about the OFFICE rather than a true
-- one about the reader.
--
-- THE LIE IS CLOSED AT ITS CAUSE, NOT BY REWORDING THE SYMPTOM. Measured across all
-- fourteen seeded roles: after this grant not one holds `customer.read` while being
-- unable both to see all owners and to own a row, so no role is left for whom an empty
-- register is a false claim. Rewording the string would have been WORSE than leaving it:
-- the two administrator roles own every row they import, so "none of these are yours"
-- becomes false for them the moment they use the importer.
--
-- WHY A MIGRATION, WHEN THE HOUSE RULE IS THAT ADDITIONS GO THROUGH THE SEED
-- -------------------------------------------------------------------------
-- `20261004120000` states that rule and it is right: `seed.ts` UPSERTS, so a grant added
-- to the grid arrives on the next seed run and only a REMOVAL needs stating in SQL.
--
-- The condition that rule assumes is that the seed will be run, and here it must not be.
-- The owner is walking this system; the standing instruction is that it must not change
-- under her, and a seed run rewrites far more than three grants. A grant that exists only
-- in the grid is also a grant that cannot be measured — and decision 57's acceptance test
-- is the role sets printed BEFORE and AFTER, which is a statement about the database.
--
-- The grid is updated too, so a database built from nothing gets the same three.
--
-- SCOPED TO THE LEGACY ROLE NAMES, DELIBERATELY — `20261004120000`'s own reasoning, and
-- it matters more for a GRANT than for a revoke. Under office-scoped roles an office may
-- have defined a role of its own called anything at all; handing `customer.all-owners.read`
-- to a row this migration has never read would be deciding one office's cross-owner
-- disclosure from a file written for another.

-- The three grants, idempotent on `RolePermission_roleId_permissionId_key`. Per
-- (role, organization), because `Role` is office-scoped: every office that has one of
-- these three roles gets it, which is what the seed would have done.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), r."organizationId", r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'customer.all-owners.read'
  AND r."name" IN (
    'CLAIMS_OFFICER',
    'FINANCE_COLLECTIONS_OFFICER',
    'PLACEMENT_TECHNICAL_OFFICER'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
DECLARE
  catalogued boolean;
  owed       integer;
  forbidden  text;
  holders    integer;
BEGIN
  -- ON A DATABASE BUILT FROM NOTHING THERE IS NOTHING HERE TO ASSERT, AND THE FLOOR
  -- BELOW CAUGHT THAT RATHER THAN A READER NOTICING IT.
  --
  -- Migrations run BEFORE the seed, so on a fresh database `Permission` and `Role` are
  -- both empty when this file executes: the INSERT above legitimately grants nothing, and
  -- the non-vacuity floor then refused the migration outright — which is exactly what a
  -- floor is for, caught by `scripts/from-empty.sh` and by nothing else, because both
  -- local databases already hold the catalogue.
  --
  -- So the whole block is conditional on the PERMISSION EXISTING, and that condition is
  -- deliberately the permission's own presence rather than "the grant count is zero".
  -- Keying the skip on a zero would make the migration silent in precisely the case the
  -- floor exists to catch — a catalogued code that reached nobody — which is the
  -- clean-nothing failure this repository has paid for repeatedly. Keyed on the code's
  -- existence, the skip means one thing only: the catalogue is not seeded yet, and the
  -- SEED is what grants these three there (the grid carries them).
  SELECT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'customer.all-owners.read')
    INTO catalogued;
  IF NOT catalogued THEN
    RAISE NOTICE 'owner decision 57: customer.all-owners.read is not catalogued yet — a database built from nothing, where the SEED grants these three from the grid. Nothing to assert.';
    RETURN;
  END IF;

  -- (1) EVERY ONE OF THE THREE, IN EVERY OFFICE THAT HAS IT, HOLDS THE CODE.
  --
  -- Asserted as a ZERO — *how many were owed it and did not get it* — rather than as a
  -- total, which is `20261029100000`'s shape and for its reason: a count of 7 is satisfied
  -- by the wrong seven, and a total also goes stale the moment a second office is
  -- registered. A zero survives both. An office that does not HAVE one of these roles is
  -- owed nothing, which is why this counts roles rather than offices: measured, dev's
  -- second office has nine seeded roles and never had Executive Management or the
  -- External Auditor.
  SELECT count(*) INTO owed
  FROM "Role" r
  WHERE r."name" IN (
      'CLAIMS_OFFICER',
      'FINANCE_COLLECTIONS_OFFICER',
      'PLACEMENT_TECHNICAL_OFFICER'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "RolePermission" rp
      JOIN "Permission" p ON p."id" = rp."permissionId"
      WHERE rp."roleId" = r."id" AND p."code" = 'customer.all-owners.read'
    );
  IF owed <> 0 THEN
    RAISE EXCEPTION 'owner decision 57: % (role, office) pair(s) were owed customer.all-owners.read and did not get it', owed;
  END IF;

  -- (2) AND THE THREE ROLES THE DECISION WITHHOLDS IT FROM STILL DO NOT HAVE IT.
  --
  -- This is the half a later grid edit breaks quietly, and it is the whole of what makes
  -- the empty state honest rather than merely non-empty: SALES must keep seeing its own
  -- book («دفترها دفترها»), and the two administrator roles must keep seeing the rows
  -- they imported, because for them an empty register is TRUE.
  SELECT string_agg(DISTINCT r."name", ', ') INTO forbidden
  FROM "Role" r
  JOIN "RolePermission" rp ON rp."roleId" = r."id"
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.all-owners.read'
    AND r."name" IN (
      'SALES_RELATIONSHIP_OFFICER',
      'OFFICE_ADMINISTRATOR',
      'SYSTEM_SECURITY_ADMINISTRATOR'
    );
  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'owner decision 57: % hold(s) customer.all-owners.read and must not — see the note above', forbidden;
  END IF;

  -- (3) THE NON-VACUITY FLOOR. Both assertions above are satisfied by a database where
  -- the code is catalogued and granted to NOBODY: nobody is owed it (no role holds it, so
  -- none of the three is singled out) and nobody forbidden holds it. That state is a real
  -- failure and it reads as a clean pass, which is the whole reason this is here — and it
  -- is reachable now rather than hypothetical, because the guard above returns early only
  -- when the code is ABSENT, never when it is present and unheld.
  SELECT count(*) INTO holders
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.all-owners.read';
  IF holders = 0 THEN
    RAISE EXCEPTION 'owner decision 57: customer.all-owners.read is catalogued and granted to NOBODY — the two assertions above passed vacuously';
  END IF;

  RAISE NOTICE 'owner decision 57: customer.all-owners.read now held at % (role, office) grant(s)', holders;
END $$;
