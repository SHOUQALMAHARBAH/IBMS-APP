-- A customer's contact details can be corrected — the first half of `IMPROVEMENTS.md` § 3.14.
--
-- WHAT § 3.14 MEASURED, AND WHY THIS IS NOT THE WHOLE FIX
-- ------------------------------------------------------
-- There is no update path for a `Customer` anywhere: no PATCH, no repository update, no permission, no
-- screen. So a misspelled name or a changed phone number cannot be fixed, and `DsrType.CORRECTION` — a
-- statutory right with a ten-working-day clock and a two-person closure — is closed by a staff member's
-- ATTESTATION with nothing in the system able to verify the data changed. The request closes and nothing
-- has happened.
--
-- This migration declares the permission for the part that carries NO regulatory consequence: phone,
-- email and registered address. Those are not screening identifiers.
--
-- THE IDENTIFIERS ARE DELIBERATELY NOT COVERED BY THIS CODE
-- --------------------------------------------------------
-- Jordan's AMLU requires screening "Upon KYC reviews or CHANGES TO A CUSTOMER'S INFORMATION", and requires
-- the other identifiers — full name, date of birth, nationality — to resolve a potential match:
--
--   https://amlu.gov.jo/EN/Pages/Frequently_Asked_Questions
--
-- So correcting a name or a date of birth is a screening event, not an edit. The owner's ruling is that the
-- RE-SCREENING MECHANISM IS THE PRECONDITION FOR EDITING THOSE FIELDS AT ALL — they ship with it and never
-- without it. `customer.update` therefore gates the three fields that trigger nothing; the identifier
-- fields will be refused by the DTO until that mechanism exists, which is a refusal by construction rather
-- than a rule somebody has to remember.

INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES (
  gen_random_uuid(),
  'customer.update',
  -- `commercial-front-office`, matching `customer.create` — NOT a new `customer` module.
  --
  -- A permission's module is what groups it on the Role matrix screen, so a lone module renders as an extra
  -- group holding one row, on the screen the four-action scheme exists for. Four-action Phase 1 made exactly
  -- that mistake with a `sales-crm` module and the matrix's module pin caught it at 12 -> 13.
  'commercial-front-office',
  'Correct a customer''s contact details — phone, email and registered address. Does NOT cover name, date of birth, nationality or identity numbers: changing one of those is a screening event under the AMLU rules, not an edit'
)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Granted to exactly the roles that can already CREATE a customer.
-- ---------------------------------------------------------------------------
-- Correcting a phone number is the owning officer's own work, and per-customer visibility still applies on
-- top: `assertCustomerVisible` means an officer can only correct a customer they own, and the
-- `customer.all-owners.read` holders reach the rest. Widening this beyond the create holders would be a
-- decision about who may alter a client record, not a convenience.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."code" = 'customer.create'
JOIN "Permission" target ON target."code" = 'customer.update'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
DECLARE
  creators integer;
  updaters integer;
BEGIN
  SELECT count(*) INTO creators
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.create';

  SELECT count(*) INTO updaters
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.update';

  -- Every role that can create a customer can now correct one. Asserted rather than assumed, and in this
  -- direction, because the failure that matters is a role able to CREATE a client record and unable to fix
  -- a typo in it — which is the state § 3.14 found and this migration exists to end.
  IF updaters < creators THEN
    RAISE EXCEPTION
      'customer.update: % role(s) hold customer.create but only % hold customer.update. A role that can create a customer must be able to correct one.',
      creators, updaters;
  END IF;
  RAISE NOTICE 'customer.update: % grant(s), against % for customer.create', updaters, creators;
END $$;
