-- MODULE 0-ب ITEM (d) — `RegulatoryAction` WAS CREATED WITHOUT ROW-LEVEL SECURITY, AND CI CAUGHT IT.
--
-- ## WHAT WENT WRONG
--
-- `20261121100000_provider_registration_fields` created the table with an `organizationId` column
-- and no RLS. `tenant-isolation.e2e-spec.ts` asserts that EVERY tenant-scoped table has RLS enabled
-- and a policy on it, and it failed with `expected [ 'RegulatoryAction' ] to deeply equal []` — the
-- guard doing exactly what it exists for, on exactly the class of table it was written for.
--
-- The hole was real while it lasted. `tenantScopeExtension` derives its scoped set from the DMMF as
-- "every model carrying an organizationId", so the APPLICATION layer was filtering this table
-- correctly from the moment it existed. What was missing is the second layer: a raw query, a
-- forgotten `where`, or a future repository reaching past the extension would have crossed offices
-- with nothing to stop it. That second layer is the whole point of spec § 1's promise that "a
-- raw/forgotten query without the app-layer filter still can't cross tenants", and it is why ten
-- raw-SQL call sites in this codebase are protected by RLS ALONE.
--
-- ## WHY IT SLIPPED
--
-- The migration asserted a great deal — the thirteen composite tenant foreign keys, the enum labels,
-- the NOT NULL, the duplicate-registration refusal proven by attempting it — and did not assert the
-- one thing that is a CONVENTION rather than a property of this table: that a new org-carrying table
-- gets `ENABLE` and `FORCE`. Measured and recorded before this module began: FORCE is the convention
-- for every table added since 2026-11-02. A convention is not a guard, which is the lesson this
-- module has now been taught twice.
--
-- `FORCE` matters here and is not ceremony: without it the table OWNER is exempt from the policy, and
-- migrations and the seed run as the owner. The API runs as `ibms_app`, a non-owner, which is the
-- arrangement that makes the policies apply to it at all.

ALTER TABLE "RegulatoryAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegulatoryAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RegulatoryAction_tenant_isolation" ON "RegulatoryAction"
  USING ("organizationId" = current_setting('app.current_org_id', true));

-- ============================================================================================
-- ASSERTIONS
-- ============================================================================================
DO $$
DECLARE
  n       INTEGER;
  enabled BOOLEAN;
  forced  BOOLEAN;
BEGIN
  -- (1) The composite tenant foreign keys are all still there — the first assertion in every
  --     migration on this branch, because a generated diff drops thirteen of them.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'f' AND conname LIKE '%\_same\_org\_fkey';
  IF n < 13 THEN
    RAISE EXCEPTION 'composite tenant FKs: only % remain, expected at least 13 — this migration dropped tenancy constraints', n;
  END IF;

  -- (2) BOTH flags. `ENABLE` alone leaves the owner exempt, and every migration and the seed connect
  --     as the owner — so a table that is ENABLEd and not FORCEd is one whose policy the most
  --     privileged connections silently ignore.
  SELECT c.relrowsecurity, c.relforcerowsecurity INTO enabled, forced
    FROM pg_class c WHERE c.oid = '"RegulatoryAction"'::regclass;
  IF enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'RegulatoryAction: row-level security is not ENABLEd';
  END IF;
  IF forced IS NOT TRUE THEN
    RAISE EXCEPTION 'RegulatoryAction: row-level security is not FORCEd — the table owner would be exempt from its own policy';
  END IF;

  -- (3) A POLICY EXISTS AND READS THE SESSION VARIABLE. Enabling RLS with no policy denies
  --     everything, which is not isolation but an outage; a policy that does not read
  --     `app.current_org_id` is one `tenantScopeExtension` can never satisfy — the exact defect that
  --     once made every permission read return empty and 403'd every user everywhere.
  SELECT count(*) INTO n FROM pg_policies
   WHERE tablename = 'RegulatoryAction'
     AND qual LIKE '%app.current_org_id%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'RegulatoryAction: expected exactly one policy reading app.current_org_id, found %', n;
  END IF;

  RAISE NOTICE 'RegulatoryAction: RLS ENABLEd and FORCEd, one policy on app.current_org_id';
END $$;
