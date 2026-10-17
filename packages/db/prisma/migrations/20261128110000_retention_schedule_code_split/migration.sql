-- MODULE 0 CLOSE, DECISION 3 — THE CODE SPLIT, AND THE UMBRELLA IS WITHDRAWN.
--
-- `20261128100000` gave `RetentionScheduleItem` its maker, checker and escape columns and the CHECK.
-- This migration splits the code that gated both halves:
--
--     retention-schedule.manage  ->  retention-schedule.update  (the maker)
--                                +   retention-schedule.confirm (the checker)
--
-- ## ITS OWN MIGRATION, BECAUSE THE SEED CANNOT REVOKE
--
-- `seed.ts` upserts grants and NEVER removes one, so re-seeding an existing database would add the
-- successors and leave the umbrella in place — and an office would hold a code that gates nothing
-- beside two that gate everything. The `20261004120000` precedent, met for the third time.
--
-- ## BOTH SUCCESSORS GO TO EVERY HOLDER, AND THAT IS THE OWNER'S DECISION NOT A SHORTCUT
--
-- "Which of the two a person holds is the office's choice, not ours." Withdrawing one half from one
-- role here would be this product deciding an office's separation of duties for it — and on the first
-- deploy, silently. A one-person office is covered by the declared merged-duties state, with the hat
-- recorded per step.
--
-- Custom roles are included for free: the expansion joins `RolePermission`, so an office's own role
-- holding the umbrella gets both successors whatever it is called.

-- ---------------------------------------------------------------------------
-- 1. The successors. `ON CONFLICT DO NOTHING` so this is re-runnable against a
--    database the seed has already touched.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES
  (gen_random_uuid(), 'retention-schedule.update', 'pdpl',
   'Set a record category''s retention period and its legal basis. The MAKER half of a maker/checker pair: whoever sets a period cannot also confirm it as Legal Counsel unless the office has declared merged duties, in which case the act is recorded'),
  (gen_random_uuid(), 'retention-schedule.confirm', 'pdpl',
   'Confirm a retention period as Legal Counsel, stamping the date AND the actor. The CHECKER half: refused for whoever set the period, unless the office has declared merged duties — in which case the declaration is recorded against the row')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Expand every grant of the umbrella into BOTH successors.
-- ---------------------------------------------------------------------------
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", successor."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN (
  VALUES
    ('retention-schedule.manage', 'retention-schedule.update'),
    ('retention-schedule.manage', 'retention-schedule.confirm')
) AS expansion("source", "successor") ON expansion."source" = source."code"
JOIN "Permission" successor ON successor."code" = expansion."successor"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. PROVE IT WHILE THE UMBRELLA IS STILL THERE TO COMPARE AGAINST. An assertion
--    after the withdrawal could only compare against what it FOUND, which is the
--    defect the from-empty check exists for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing INTEGER;
  holders INTEGER;
BEGIN
  SELECT count(*) INTO holders
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
   WHERE p."code" = 'retention-schedule.manage';

  -- NOT AN ERROR WHEN ZERO, and it says so: a database built from nothing has no umbrella grants to
  -- expand, because the seed now declares the successors directly. Silence here would read as
  -- "expanded successfully".
  IF holders = 0 THEN
    RAISE NOTICE 'no retention-schedule.manage grants exist — nothing to expand (expected on a database built from empty)';
  ELSE
    CREATE TEMP TABLE expansion("source" text, "successor" text) ON COMMIT DROP;
    INSERT INTO expansion VALUES
      ('retention-schedule.manage', 'retention-schedule.update'),
      ('retention-schedule.manage', 'retention-schedule.confirm');

    SELECT count(*) INTO missing
      FROM (
        SELECT rp."roleId", e."successor"
          FROM "RolePermission" rp
          JOIN "Permission" p ON p."id" = rp."permissionId"
          JOIN expansion e ON e."source" = p."code"
      ) owed
     WHERE NOT EXISTS (
       SELECT 1 FROM "RolePermission" held
        JOIN "Permission" hp ON hp."id" = held."permissionId"
       WHERE held."roleId" = owed."roleId" AND hp."code" = owed."successor"
     );

    IF missing > 0 THEN
      RAISE EXCEPTION
        'retention-schedule split: % (role, successor) grant(s) were owed and not written. Nobody may lose a capability to a rename.',
        missing;
    END IF;
    RAISE NOTICE 'retention-schedule split: % umbrella grant(s) expanded into both successors', holders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Withdraw the umbrella. Grants first, then the catalogue row.
-- ---------------------------------------------------------------------------
DELETE FROM "RolePermission"
 WHERE "permissionId" IN (
   SELECT "id" FROM "Permission" WHERE "code" = 'retention-schedule.manage'
 );

DELETE FROM "Permission" WHERE "code" = 'retention-schedule.manage';

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM "Permission" WHERE "code" = 'retention-schedule.manage';
  IF n <> 0 THEN
    RAISE EXCEPTION 'retention-schedule.manage survived the withdrawal — an office would hold a code that gates nothing';
  END IF;

  -- AND BOTH SUCCESSORS EXIST, which the delete above could otherwise have left as the only change.
  SELECT count(*) INTO n FROM "Permission"
   WHERE "code" IN ('retention-schedule.update', 'retention-schedule.confirm');
  IF n <> 2 THEN
    RAISE EXCEPTION 'expected both retention-schedule successors in the catalogue, found %', n;
  END IF;

  RAISE NOTICE 'retention-schedule.manage withdrawn; .update and .confirm in place';
END $$;
