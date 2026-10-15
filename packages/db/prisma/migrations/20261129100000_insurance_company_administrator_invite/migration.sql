-- MODULE 0-ب ITEM (f), THE COMPANY HALF — the provider may invite an insurance company's FIRST
-- administrator.
--
-- ## A SEPARATE CODE FROM THE OFFICE INVITE, NOT A REUSE
--
-- `provider.office.administrator.invite` names an office. Letting it also reach an insurance company
-- would make the name promise other than it does — the defect class this close measured in
-- `aml.monitor` (gates an alert queue, promises monitored transactions) and `sanctions-pep.screen`
-- (promises PEP screening against a catalogue of two SANCTIONS lists and no PEP source). Renaming an
-- existing code touches every role that holds it in every office and is the LAST option considered,
-- so the honest move is a second code.
--
-- The two acts also differ in what they hand over: an office administrator receives 47 codes and runs
-- an office; a company administrator receives SIX — self-administration only — because an insurance
-- company has nothing else to do in this product yet.
--
-- ## WHY A MIGRATION AND NOT JUST THE SEED
--
-- Deferred register entry 33, found earlier in this same close: a code added by the SEED reaches only
-- databases where the seed has re-run, while a code added by a MIGRATION reaches both. Item (f)'s
-- office code arrived by seed and was therefore ABSENT from dev — the provider could not invite an
-- office administrator on the owner's own walkthrough database, and no schema gate could see it
-- because `db:checksums`, `db:divergence` and `db:privileges` all compare the schema while a
-- catalogue row is data. This code arrives by migration so that cannot repeat.
--
-- ## PLATFORM SCOPE, STATED RATHER THAN DEFAULTED
--
-- `Permission.scope` defaults to OFFICE — the non-widening value, deliberately, so a code added later
-- cannot become platform-wide by omission. This one IS platform-wide, so it says so.

-- ---------------------------------------------------------------------------
-- 1. The code. `ON CONFLICT DO NOTHING` so this is re-runnable against a
--    database the seed has already touched.
-- ---------------------------------------------------------------------------
INSERT INTO "Permission" ("id", "code", "module", "scope", "description")
VALUES
  (gen_random_uuid(), 'provider.insurance-company.administrator.invite', 'admin', 'PLATFORM',
   'Create the FIRST user account inside an insurance company the provider has registered, and grant it that company''s administrator role. Like the brokerage-office invite it crosses a tenancy boundary and is refused once the company has any account. The company administrator it creates holds SIX self-administration codes and nothing more — a company reads its own registry record and has no other capability in this product. The invited administrator is created with NO usable password and signs in by requesting a password reset')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Grant it to the provider's own role, IF a provider exists.
--
--    On a from-empty database it does not: `ensureProviderOrganization()` runs
--    in the SEED, after migrations, because a migration that invents an
--    organization invents a tenant. Zero rows here is therefore correct, and
--    the seed grants the code when it creates the role.
-- ---------------------------------------------------------------------------
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), r."organizationId", r."id", p."id"
FROM "Role" r
JOIN "Organization" o ON o."id" = r."organizationId"
JOIN "Permission" p ON p."code" = 'provider.insurance-company.administrator.invite'
WHERE o."type" = 'PROVIDER'
  AND r."name" = 'PLATFORM_OPERATOR'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Assertions. Three, and the third is the one that matters.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  code_scope TEXT;
  providers  INTEGER;
  granted    INTEGER;
  leaked     INTEGER;
BEGIN
  SELECT "scope"::text INTO code_scope
  FROM "Permission" WHERE "code" = 'provider.insurance-company.administrator.invite';

  IF code_scope IS NULL THEN
    RAISE EXCEPTION 'the code was not inserted';
  END IF;

  IF code_scope <> 'PLATFORM' THEN
    RAISE EXCEPTION 'the code is % scoped, expected PLATFORM. An OFFICE-scoped invite code could be granted by an office to its own role, which would let a brokerage office create accounts inside an insurance company.', code_scope;
  END IF;

  SELECT count(*) INTO providers FROM "Organization" WHERE "type" = 'PROVIDER';

  SELECT count(*) INTO granted
  FROM "RolePermission" rp
  JOIN "Organization" o ON o."id" = rp."organizationId"
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE o."type" = 'PROVIDER'
    AND p."code" = 'provider.insurance-company.administrator.invite';

  IF providers > 0 AND granted = 0 THEN
    RAISE EXCEPTION 'a PROVIDER organization exists but was not granted the code. Entry 33 again: the grant has to arrive with the migration, not only with the seed.';
  END IF;

  -- THE ONE THAT MATTERS. A PLATFORM code held by a non-provider organization is the invariant
  -- module 0 item (j) closed with three layers, and this is the fourth place it is checked.
  SELECT count(*) INTO leaked
  FROM "RolePermission" rp
  JOIN "Organization" o ON o."id" = rp."organizationId"
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE o."type" <> 'PROVIDER'
    AND p."code" = 'provider.insurance-company.administrator.invite';

  IF leaked > 0 THEN
    RAISE EXCEPTION '% non-provider organization(s) hold a PLATFORM code. An office holding this could create accounts inside an insurance company.', leaked;
  END IF;

  RAISE NOTICE 'provider.insurance-company.administrator.invite: PLATFORM, % provider(s), % grant(s), 0 leaked', providers, granted;
END $$;
