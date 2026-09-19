-- Office-scoped custom RBAC, Phase 3 PREP — `role.manage` and
-- `permission.manage` gated read-only GETs. Settle the names before Phase 3's
-- permission-matrix screen is built against them.
--
-- WHY A RENAME IN PLACE, NOT A DELETE-AND-RECREATE
-- ------------------------------------------------
-- `seed.ts` upserts permissions and their grants and never removes one (the
-- lesson migration 20261004120000 records), so the old codes would survive a
-- reseed forever. Deleting them instead would cascade their `RolePermission`
-- rows away and open a window — between this migration and the next seed run —
-- in which nobody in the office can read the role or permission catalogue.
--
-- An UPDATE of the `code` column has neither problem: the row keeps its id, so
-- every existing grant follows the rename automatically, and there is no moment
-- when the capability does not exist. On a database seeded from EMPTY these
-- statements match nothing and the seed creates the new codes directly, so both
-- paths converge — which is verified by comparing the whole grid's md5 across a
-- scratch database, dev and db-test.
--
-- WHAT EACH ONE BECOMES
-- ---------------------
-- `role.manage`      -> `role.read`        (viewing the catalogue)
-- `permission.manage`-> `permission.read`  (viewing the global catalogue)
--
-- A NEW `role.manage` is then created by the seed, meaning what it says:
-- changing the office's roles. Nothing gates on it yet; Phase 3's Role CRUD
-- will. The order matters — renaming first means the new `role.manage` cannot
-- collide with the old row on `Permission.code`'s unique index.
--
-- There is deliberately NO new `permission.manage`. `Permission` is a single
-- global catalogue describing what the software can do; an office grants
-- permissions and never invents one, so a write capability there would name an
-- action that cannot exist. That one is a rename, not a split.

UPDATE "Permission"
SET "code" = 'role.read',
    "description" = 'View the office''s role catalogue'
WHERE "code" = 'role.manage';

UPDATE "Permission"
SET "code" = 'permission.read',
    "description" = 'View the global permission catalogue (the codes a role can be granted)'
WHERE "code" = 'permission.manage';
