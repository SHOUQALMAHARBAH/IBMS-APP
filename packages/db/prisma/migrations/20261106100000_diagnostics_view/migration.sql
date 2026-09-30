-- Implementation detail stops being reserved to a ROLE NAME.
--
-- WHAT WAS THERE
-- --------------
-- `apps/web/app/(app)/settings/email/page.tsx` decided whether to show the raw API error message with
--
--     const seesInternalDetail = !!user && user.roles.includes('SYSTEM_SECURITY_ADMINISTRATOR');
--
-- That is the frontend directive implemented as written — it reserves implementation detail to the
-- System/Security Administrator, naming a role — and it is what the office-scoped RBAC design forbids.
--
-- WHY A ROLE NAME IS NOT AN IDENTITY, in this specific case
-- --------------------------------------------------------
-- An office defines its own roles under its own names. An office that names its security administrator
-- anything else, or defines an equivalent role, is SILENTLY UNRECOGNISED by that line: no error, no
-- complaint, just a weaker message and no way to find out why. The same reasoning produced `customer.read`
-- (migration 20261105100000) and the rule that the 100 permission refusals name the administrator BY
-- FUNCTION rather than by role name — having removed role names from a hundred sentences, the code must not
-- then read one.
--
-- WHY THIS IS A DISPLAY GATE AND THAT IS HONEST
-- ---------------------------------------------
-- There is nothing to gate server-side: the API always returns its message, and the web decides whether to
-- render it. So this code is read only by `apps/web`, which `permission-enforcement.inventory.spec.ts`
-- counts as enforced — its ROOTS include the web app deliberately, because a code read by a service or a
-- screen is enforced, just not at a route.

INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES (
  gen_random_uuid(),
  'diagnostics.view',
  -- `admin`, beside `security-config.read`/`.manage` and `encryption-key.read`. NOT a new `diagnostics`
  -- module: a permission's module groups it on the Role matrix, so a lone module renders as an extra group
  -- holding one row — the `sales-crm` mistake four-action Phase 1 made and its module pin caught.
  'admin',
  'See raw technical detail when something fails — the server''s own error text, meant for whoever maintains the system rather than for the person doing the work. Nothing is hidden from the audit trail by withholding this; it only decides whether a screen shows the underlying message or a plain sentence'
)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Granted to exactly the role the role-name read already matched, so BEHAVIOUR DOES NOT CHANGE.
-- ---------------------------------------------------------------------------
-- The line it replaces tested `roles.includes('SYSTEM_SECURITY_ADMINISTRATOR')`. Granting this to that role
-- and to nobody else means every existing office sees precisely what it saw before — the defect being fixed
-- is that an office with a DIFFERENTLY NAMED administrator saw less, and from here such a role can simply be
-- granted the code. Widening it now would bundle a capability change into a correctness fix.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), r."organizationId", r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'diagnostics.view'
  AND r."name" = 'SYSTEM_SECURITY_ADMINISTRATOR'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
DECLARE
  admins integer;
  granted integer;
BEGIN
  SELECT count(*) INTO admins FROM "Role" WHERE "name" = 'SYSTEM_SECURITY_ADMINISTRATOR';

  SELECT count(*) INTO granted
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'diagnostics.view';

  -- Asserted in the direction that matters: the role the old line matched must hold the code that replaces
  -- it, in EVERY office. A role short of it would see less detail after this migration than before, which
  -- would make a correctness fix into a silent regression — the exact failure mode being fixed, inverted.
  IF granted < admins THEN
    RAISE EXCEPTION
      'diagnostics.view: % SYSTEM_SECURITY_ADMINISTRATOR role(s) exist but only % hold diagnostics.view. Every office that saw raw error detail before this migration must still see it.',
      admins, granted;
  END IF;
  RAISE NOTICE 'diagnostics.view: % grant(s) across % administrator role(s)', granted, admins;
END $$;
