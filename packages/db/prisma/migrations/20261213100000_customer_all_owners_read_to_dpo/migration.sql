-- OWNER DECISION — `customer.all-owners.read` reaches DATA_PROTECTION_OFFICER.
--
-- NO PERMISSION IS MINTED. The code exists, is already held by seven roles, and already
-- means exactly this. The catalogue total does not move.
--
-- WHAT THIS CLOSES
-- ----------------
-- Register row 2.2 in the owner's own words — «في حقل صاحب البيانات لما أبحث عن عميل
-- موجود بيحكيلي إنه غير متوفر», *in the data-subject field, when I search for a customer
-- that exists it tells me it is not available* — and the `/consent` `filterCustomerId`
-- row beside it. They are ONE cause, not two.
--
-- THE GATE WAS NEVER THE PROBLEM, which is a correction to the brief this implements.
-- The DPO reaches `GET /customers/search` already: `CUSTOMER_SEARCH_CODES` is
-- `['customer.read', 'dsr.log']` and the DPO holds `dsr.log` — the widening the picker
-- rule shipped for exactly this screen. What emptied the result is the line BELOW it,
-- `canReadAllCustomerOwners(actor) ? undefined : actor.id` in
-- `customer.service.ts#search`, which narrows the search to the customers the actor OWNS.
-- Ownership is creator-assigned with no transfer path (`customer.create` is SALES alone;
-- `customer.bulk-import` is the two administrator roles, whose importer writes
-- `ownerUserId: actorUserId`), so the DPO could never own one and the search returned
-- zero rows for every word, permanently and by construction.
--
-- WHAT IT OPENS — MEASURED, BECAUSE THIS IS A PRIVACY GRANT
-- --------------------------------------------------------
-- `customer.all-owners.read` is evaluated at SIX decision sites in THREE services, all
-- through `rbac-visibility.util.ts`. Against the DPO's own grants:
--
--   customer.service.ts#search           GET /customers/search    CUSTOMER_SEARCH_CODES   REACHED
--   customer.service.ts#list             GET /customers           customer.read           403
--   customer.service.ts#findOwnedOr...   GET /customers/:id ...   customer.360-view.read  403
--   crm.service.ts#findVisibleCustomer   interactions, 360-view   interaction.log /
--                                                                 customer.360-view.read  403
--   kyc.service.ts#isCrossOwner  x2      the KYC file             kyc.capture / kyc.approve
--                                                                 / screening.run         403
--
-- The DPO holds 27 codes and NOT ONE `customer.*`, `kyc.*` or `screening.*` code —
-- measured off this database rather than read off the grid. So the grant opens exactly
-- ONE route, and that route returns a name, a type, a status and the two cleartext
-- CORPORATE identifiers: no contact details, no screening discriminators, no owner.
--
-- THE PREMISE IS ASSERTED HERE, NOT ONLY IN A TEST
-- ------------------------------------------------
-- The grant is justified by an ABSENCE: the DPO cannot open a customer file. Assertion
-- (2) below therefore refuses the migration if the DPO holds `customer.360-view.read` or
-- any of the four codes that reach the other five decision sites. If somebody later gives
-- the DPO the 360° view, the thing that must fail is the statement that justified THIS
-- grant — not a screen, quietly, months later.
--
-- NOT `customer-file.all-owners.read`, a different code one row over: that is the
-- COMMERCIAL file across nine services. Confusing the two is how a one-field fix becomes
-- a disclosure decision.
--
-- WHY A MIGRATION RATHER THAN THE SEED ALONE: `20261004120000`'s rule is that additions
-- go through the grid because `seed.ts` upserts. That rule assumes the seed will be run,
-- and the owner is walking this system — it must not change under her, and a seed run
-- rewrites far more than one grant. The grid is updated too, so a database built from
-- nothing gets the same grant.
--
-- SCOPED TO THE LEGACY ROLE NAME, DELIBERATELY. Under office-scoped roles an office may
-- have defined a role of its own called anything at all; handing a cross-owner read to a
-- row this migration has never seen would be deciding one office's disclosure from a file
-- written for another.

INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), r."organizationId", r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE p."code" = 'customer.all-owners.read'
  AND r."name" = 'DATA_PROTECTION_OFFICER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
DECLARE
  catalogued boolean;
  owed       integer;
  leaked     text;
  holders    integer;
BEGIN
  -- Migrations run BEFORE the seed, so on a database built from nothing `Permission` and
  -- `Role` are both empty here: the INSERT grants nothing legitimately and every
  -- assertion below would be vacuous. Keyed on the code's EXISTENCE rather than on a
  -- count being zero — keying it on a zero would make this silent in precisely the case
  -- the floor exists to catch, a catalogued code that reached nobody.
  SELECT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'customer.all-owners.read')
    INTO catalogued;
  IF NOT catalogued THEN
    RAISE NOTICE 'DPO customer grant: customer.all-owners.read is not catalogued yet — a database built from nothing, where the SEED grants it from the grid. Nothing to assert.';
    RETURN;
  END IF;

  -- (1) EVERY DPO ROLE, IN EVERY OFFICE THAT HAS ONE, HOLDS IT. A zero rather than a
  -- total: a count of 1 is satisfied by the wrong one, and a total goes stale the moment
  -- a second office registers a DPO.
  SELECT count(*) INTO owed
  FROM "Role" r
  WHERE r."name" = 'DATA_PROTECTION_OFFICER'
    AND NOT EXISTS (
      SELECT 1 FROM "RolePermission" rp
      JOIN "Permission" p ON p."id" = rp."permissionId"
      WHERE rp."roleId" = r."id" AND p."code" = 'customer.all-owners.read'
    );
  IF owed <> 0 THEN
    RAISE EXCEPTION 'DPO customer grant: % DATA_PROTECTION_OFFICER role(s) were owed customer.all-owners.read and did not get it', owed;
  END IF;

  -- (2) THE PREMISE. The DPO must still be unable to OPEN a customer file — that absence
  -- is the whole justification for widening its search, and it is what keeps this a
  -- picker fix rather than a customer-file disclosure.
  SELECT string_agg(DISTINCT p."code", ', ') INTO leaked
  FROM "Role" r
  JOIN "RolePermission" rp ON rp."roleId" = r."id"
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE r."name" = 'DATA_PROTECTION_OFFICER'
    AND p."code" IN (
      'customer.360-view.read',
      'customer.read',
      'kyc.capture',
      'kyc.approve',
      'screening.run'
    );
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'DPO customer grant: DATA_PROTECTION_OFFICER now holds % — the absence that justified widening its search is gone, so re-decide the grant rather than keeping both', leaked;
  END IF;

  -- (3) THE NON-VACUITY FLOOR. Both assertions above pass on a database where the code is
  -- catalogued and granted to NOBODY: nobody is owed it, and nothing is leaked. That
  -- state is a real failure that reads as a clean pass.
  SELECT count(*) INTO holders
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.all-owners.read';
  IF holders = 0 THEN
    RAISE EXCEPTION 'DPO customer grant: customer.all-owners.read is catalogued and granted to NOBODY — the assertions above passed vacuously';
  END IF;

  RAISE NOTICE 'DPO customer grant: customer.all-owners.read now held at % (role, office) grant(s)', holders;
END $$;
