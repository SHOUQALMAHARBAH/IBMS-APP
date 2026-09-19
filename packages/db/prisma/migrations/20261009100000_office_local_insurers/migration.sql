-- Insurer management — an office can register a company that is in no global
-- catalogue, so the global row stops being a prerequisite.
--
-- WHY THE MASTER LINK BECOMES NULLABLE
-- -----------------------------------
-- `Insurer` is one office's relationship with a real insurance company, and the
-- company's identity lives on the GLOBAL `InsurerMaster`. That is the right split
-- and it stays — but it made a global row mandatory, which is exactly the
-- prerequisite the requirement rules out: an Office Administrator must be able to
-- register an insurer nobody has catalogued yet.
--
-- WHY NOT AUTO-CREATE A MASTER ROW INSTEAD
-- ---------------------------------------
-- `InsurerMaster.legalName` is UNIQUE PLATFORM-WIDE. An office entering "Acme
-- Insurance" would get a unique violation if another office had already entered
-- it — turning an error message into an oracle for what other offices deal with,
-- and giving an office a way to probe the platform by name. There is no wording
-- that makes that error safe, which is what makes this a data-model decision
-- rather than a copy one. Two further reasons: writing a global row IS
-- `insurer.master.manage`, a capability the Office Administrator deliberately does
-- not hold; and `InsurerMaster.linesOffered` is global, so one office editing it
-- would change what every other office sees.
--
-- BACKFILL: NONE
-- --------------
-- Every existing `Insurer` keeps its master link, so no row's resolved identity
-- changes. That is what makes this migration's acceptance gate a schema assertion
-- plus an empty per-insurer name diff, rather than a data migration.

-- 1. The link becomes optional.
ALTER TABLE "Insurer" ALTER COLUMN "insurerMasterId" DROP NOT NULL;

-- 2. Office-local identity, populated only when there is no master link.
--    `linesOffered` mirrors `InsurerMaster.linesOffered` for a company that has
--    no global row to carry it. Distinct from `InsurerProduct`, which is what
--    THIS office actually places with them.
ALTER TABLE "Insurer" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Insurer" ADD COLUMN "legalNameAr" TEXT;
ALTER TABLE "Insurer" ADD COLUMN "linesOffered" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 3. A nameless row is refused by the DATABASE, not by convention.
--
--    Every consumer reads an insurer's name through `insurer-identity.ts`, which
--    coalesces master name over local name. A row with neither would resolve to
--    NULL everywhere — in a comparison matrix, a policy schedule, a generated
--    certificate. This is a "one of these" invariant, which
--    ibms-brain/meta/lex/race-safe-invariants.md says is a constraint rather than
--    an application check.
ALTER TABLE "Insurer"
  ADD CONSTRAINT "Insurer_has_identity"
  CHECK ("insurerMasterId" IS NOT NULL OR "legalName" IS NOT NULL);

-- 4. One local company name per office, case-insensitively.
--
--    TWO PARTIAL INDEXES, NOT ONE COMPOSITE. The existing
--    `@@unique([organizationId, insurerMasterId])` keeps master-linked rows
--    unique per office, and stops constraining local rows automatically because
--    Postgres does not collide NULLs. So the local case needs its own index,
--    scoped with `WHERE "insurerMasterId" IS NULL`.
--
--    This repository has hit the NULL-uniqueness trap twice before (#48's
--    screening keys, #59's sales targets) and the answer both times was two
--    partial indexes rather than one composite. Same answer here.
--
--    `lower("legalName")` rather than the raw column: an office must not be able
--    to create both "Acme Insurance" and "ACME INSURANCE" and then wonder which
--    one its policies are against. `legalNameAr` is deliberately NOT in the index
--    — Arabic has no case, and a second identity key would compete with this one.
--
--    ⚠️ Prisma cannot express a partial unique index or `lower()` in `@@unique`,
--    so `prisma migrate dev` will report this as drift and offer to "fix" it. Do
--    NOT accept — same warning as
--    `UserRoleAssignment_one_active_per_user_role`.
CREATE UNIQUE INDEX "Insurer_one_local_name_per_org"
  ON "Insurer" ("organizationId", lower("legalName"))
  WHERE "insurerMasterId" IS NULL;

-- 5. One product row per line per insurer.
--
--    `InsurerProduct` has been in the schema since the model was created and has
--    never had a reader — the seed writes rows, no application code reads one.
--    The insurer screen is its first consumer, and it replaces the whole line set
--    in one transaction, so "this insurer offers this line, once" needs to be a
--    database invariant before anything relies on it. Neither column is nullable,
--    so this one is a plain compound unique with no NULL trap.
--
--    Verified before adding: zero duplicate (insurerId, insuranceLine) groups on
--    both the dev and test databases, so this cannot fail on existing data.
CREATE UNIQUE INDEX "InsurerProduct_insurerId_insuranceLine_key"
  ON "InsurerProduct" ("insurerId", "insuranceLine");
