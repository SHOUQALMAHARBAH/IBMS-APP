-- MODULE 0 ITEM (j), GAP CLOSURE — withdraw every PLATFORM-scoped grant from a non-provider office.
--
-- ============================================================================================
-- WHY A MIGRATION AND NOT A SEED CHANGE
-- ============================================================================================
-- `seed.ts` UPSERTS grants and never REMOVES one. That is deliberate — under office-scoped custom
-- roles, an office's own grants are precisely the rows absent from the grid, so a pruning seed would
-- delete them — and it means narrowing the grid leaves every existing database with the old grant
-- intact. RESEEDING DOES NOT REVOKE. The `20261004120000_withdraw_incident_classify` precedent, met
-- for the second time.
--
-- Measured before writing this, on both databases:
--
--   Default Brokerage Office | BROKERAGE_OFFICE | SYSTEM_SECURITY_ADMINISTRATOR
--   IBMS Platform Operator   | PROVIDER         | PLATFORM_OPERATOR
--
-- The first row is the state item (j)'s gap closure forbids: a brokerage office's own role holding a
-- code whose effect reaches every other office. It was granted by item (j) itself, which shipped the
-- code with `roles: [ADMIN]` before the PROVIDER type existed to hold it.
--
-- ============================================================================================
-- SCOPED TO NON-PROVIDER ORGANIZATIONS, NOT TO A ROLE NAME
-- ============================================================================================
-- The legacy sibling scoped its withdrawal to a role NAME, which was right then: it was undoing one
-- grant to one seeded role. Here the rule is about the ORGANIZATION's type, and an office may have
-- named its administrator role anything at all since Phase 3 — so matching on a name would leave a
-- custom role holding it and report success.
--
-- It is also written over EVERY platform-scoped code rather than this one by name, so the next
-- platform code added to a brokerage office by accident is withdrawn by a migration that already
-- exists rather than needing a new one.
--
-- The PROVIDER organization's own grant is untouched, which is the whole point: the capability moves
-- rather than disappearing.

DELETE FROM "RolePermission" rp
 USING "Permission" p, "Organization" o
 WHERE rp."permissionId" = p."id"
   AND rp."organizationId" = o."id"
   AND p."scope" = 'PLATFORM'
   AND o."type" <> 'PROVIDER';

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  leftover INTEGER;
  provider INTEGER;
  codes    INTEGER;
BEGIN
  -- 1. NO non-provider organization holds a platform-scoped grant any more. The claim this
  --    migration exists to make, asserted rather than inferred from the DELETE's row count — a
  --    DELETE that matched nothing reports success just as loudly as one that cleaned up.
  SELECT count(*) INTO leftover
    FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    JOIN "Organization" o ON o."id" = rp."organizationId"
   WHERE p."scope" = 'PLATFORM' AND o."type" <> 'PROVIDER';
  IF leftover <> 0 THEN
    RAISE EXCEPTION 'platform grant withdrawal: % grant(s) of a PLATFORM code remain outside the provider organization', leftover;
  END IF;

  -- 2. THE CAPABILITY MOVED RATHER THAN VANISHING — but only where a provider organization exists.
  --
  --    On a database seeded WITHOUT sample data (production), there is no PROVIDER organization and
  --    therefore no grant, and that is correct rather than a failure: the dashboard is unreachable
  --    until somebody deliberately creates the operator. So this asserts the conditional, not the
  --    presence, which is the honest form.
  SELECT count(*) INTO provider FROM "Organization" WHERE "type" = 'PROVIDER';
  SELECT count(*) INTO codes FROM "Permission" WHERE "scope" = 'PLATFORM';
  IF provider > 0 AND codes > 0 THEN
    SELECT count(*) INTO leftover
      FROM "RolePermission" rp
      JOIN "Permission" p ON p."id" = rp."permissionId"
      JOIN "Organization" o ON o."id" = rp."organizationId"
     WHERE p."scope" = 'PLATFORM' AND o."type" = 'PROVIDER';
    IF leftover = 0 THEN
      RAISE EXCEPTION 'platform grant withdrawal: a PROVIDER organization exists and holds NO platform grant — the capability was withdrawn from the offices and never moved';
    END IF;
  END IF;

  RAISE NOTICE 'platform grant withdrawal: 0 platform grants outside the provider; % provider organization(s), % platform code(s).', provider, codes;
END $$;
