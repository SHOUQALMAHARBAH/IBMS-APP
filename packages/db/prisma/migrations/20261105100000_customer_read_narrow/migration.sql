-- A narrow customer read, so finding a customer stops requiring the right to read one.
--
-- WHAT WAS MEASURED
-- -----------------
-- `GET /customers` — the plain list — was gated on `customer.360-view.read`, the SAME code as
-- `GET /customers/:id`, the aggregated 360° view. No narrower customer-read code existed, so there was
-- nothing else the list could have been gated on. Five roles hold it, and two consequences followed:
--
--   * PLACEMENT, CLAIMS and FINANCE hold `interaction.log` — they may record a touchpoint AGAINST a
--     customer — and could not list customers.
--   * SYSTEM_SECURITY_ADMINISTRATOR and OFFICE_ADMINISTRATOR hold `customer.bulk-import` — they may load
--     an office's whole back-book — and could not see a customer afterwards.
--
-- THE ALTERNATIVE THAT WAS REJECTED, AND WHY
-- ------------------------------------------
-- Widening `customer.360-view.read` to those five roles would have been one line, and would have handed
-- them the entire customer record: history, cross-sell, up-sell, insurance programmes, risk profiles, the
-- UBO register, the document list, and the reveal endpoint. Those roles need to FIND a customer, not to
-- read one.
--
-- This is the same decision as `employee.national-id.reveal`'s narrow search: an operational path that
-- does not open the directory.
--
-- SCOPE — one route moves, and only one
-- -------------------------------------
-- `customer.360-view.read` keeps `GET /customers/:id`, `POST /customers/:id/reveal-field`,
-- `GET /customers/:id/ubos` and `GET /customers/:id/documents` exactly as they were. It is not widened and
-- it loses nothing except the list.

INSERT INTO "Permission" ("id", "code", "module", "description")
VALUES (
  gen_random_uuid(),
  'customer.read',
  -- `commercial-front-office`, matching `customer.create`, `customer.update` and
  -- `customer.360-view.read`. NOT a new `customer` module: a permission's module is what groups it on the
  -- Role matrix screen, so a lone module renders as an extra group holding one row. Four-action Phase 1 made
  -- exactly that mistake with a `sales-crm` module and the matrix's module pin caught it at 12 -> 13.
  'commercial-front-office',
  'List customers and read a customer''s basic identity — the path for finding a customer. Does NOT cover the aggregated 360° view, the UBO register, the document list or revealing a masked field, all of which stay under customer.360-view.read'
)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Granted from THREE source codes, because three different reasons put a role on this list.
-- ---------------------------------------------------------------------------
-- (1) Every role that already holds `customer.360-view.read`. This one is not a widening — it is what
--     stops the split being a LOSS. The list route moves onto the new code, so a role holding only the old
--     one would silently lose the ability to list customers. The assertion below is written in exactly that
--     direction.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."code" = 'customer.360-view.read'
JOIN "Permission" target ON target."code" = 'customer.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- (2) Every role that may log an interaction against a customer. Recording a touchpoint with somebody you
--     cannot find is not a capability.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."code" = 'interaction.log'
JOIN "Permission" target ON target."code" = 'customer.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- (3) Every role that may bulk-import customers. Writing hundreds of customer rows and then being unable to
--     see one of them is the sharpest of the three: the import's own result report names records the
--     importer cannot open.
INSERT INTO "RolePermission" ("id", "organizationId", "roleId", "permissionId")
SELECT gen_random_uuid(), rp."organizationId", rp."roleId", target."id"
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."code" = 'customer.bulk-import'
JOIN "Permission" target ON target."code" = 'customer.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
DECLARE
  missing_source text;
  missing_count integer;
BEGIN
  -- NOBODY LOSES A CAPABILITY, asserted per source code and naming which one failed.
  --
  -- Three separate checks rather than one count, because a single total cannot say WHICH reason went
  -- unserved — and the three carry different consequences. A role that loses the list because check (1)
  -- did not fire has had a capability taken away by a migration that was supposed to add one.
  FOR missing_source IN
    SELECT unnest(ARRAY['customer.360-view.read', 'interaction.log', 'customer.bulk-import'])
  LOOP
    SELECT count(*) INTO missing_count
    FROM "RolePermission" rp
    JOIN "Permission" source ON source."id" = rp."permissionId" AND source."code" = missing_source
    WHERE NOT EXISTS (
      SELECT 1
      FROM "RolePermission" have
      JOIN "Permission" target ON target."id" = have."permissionId" AND target."code" = 'customer.read'
      WHERE have."roleId" = rp."roleId" AND have."organizationId" = rp."organizationId"
    );

    IF missing_count > 0 THEN
      RAISE EXCEPTION
        'customer.read: % (role, office) grant(s) holding % were owed customer.read and did not get it.',
        missing_count, missing_source;
    END IF;
  END LOOP;

  SELECT count(*) INTO missing_count
  FROM "RolePermission" rp
  JOIN "Permission" p ON p."id" = rp."permissionId"
  WHERE p."code" = 'customer.read';
  RAISE NOTICE 'customer.read: % grant(s) written', missing_count;
END $$;
