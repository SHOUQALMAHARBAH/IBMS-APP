-- The runtime role's privileges are asserted where it matters: on the database being deployed to.
--
-- ============================================================================
-- THE PATH THIS CLOSES, WHICH NOTHING CAUGHT
-- ============================================================================
--
-- `tenant-isolation.e2e-spec.ts` asserted that `ibms_app` has no SUPERUSER and no BYPASSRLS. That
-- is true and it is not enough, because neither attribute is the only route to owner privileges:
--
--     GRANT ibms TO ibms_app;     -- rolsuper stays FALSE
--
-- The runtime role then INHERITS the owner's privileges, and **Postgres exempts a table's owner
-- from its own RLS policies**. Measured by planting exactly that on db-test: `rolsuper` remained
-- `false`, every existing attribute assertion kept passing, and an unfiltered cross-office read on
-- the app role returned **13,774 rows where 1 was expected**, spanning two offices instead of one.
--
-- That is the one path that could leak another office's data, and it leaves no trace in the
-- attribute columns a reviewer would check.
--
-- ============================================================================
-- WHY HERE AS WELL AS IN A TEST, AND WHAT THIS STILL DOES NOT COVER
-- ============================================================================
--
-- A test runs against `db-test` and against CI's throwaway database. Neither is the database the
-- application is deployed to, and a `GRANT` is an act performed ON a database — by a DBA, a
-- provisioning script, or a migration — so it is exactly the class of change a test cannot see.
-- This block executes wherever the schema lands.
--
-- **But a migration runs ONCE.** It catches a grant that already existed when this deploy ran; it
-- cannot catch one made afterwards. The recurring half is `npm run db:privileges`
-- (`packages/db/scripts/check-app-role-privileges.mjs`), wired into `scripts/verify.sh` and into
-- CI beside the checksum and divergence gates, which re-checks on every run. Both, deliberately:
-- the migration is the one that runs on the production database, the script is the one that runs
-- every time.

DO $assert$
DECLARE
  r            record;
  memberships  text;
BEGIN
  SELECT rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb
    INTO r
    FROM pg_roles
   WHERE rolname = 'ibms_app';

  IF NOT FOUND THEN
    -- Deliberately NOT a failure. On a database provisioned without the non-owner role the
    -- application connects as the table OWNER and row-level security is inert — but that is
    -- already reported, loudly, by `PrismaService`'s constructor at boot, and failing the schema
    -- migration here would block a deploy for a condition the application itself diagnoses
    -- better. Skipping keeps this assertion about PRIVILEGE ESCALATION, which is its subject.
    RAISE NOTICE 'Role ibms_app does not exist on this database; skipping the runtime-role privilege assertion. The application will report at boot that it is connecting as the table owner, which makes RLS inert.';
    RETURN;
  END IF;

  IF r.rolsuper THEN
    RAISE EXCEPTION 'The runtime role ibms_app is SUPERUSER. It can then read past every RLS policy, disable the AuditLogEntry immutability triggers via session_replication_role, and do anything else. Refusing to deploy.';
  END IF;
  IF r.rolbypassrls THEN
    RAISE EXCEPTION 'The runtime role ibms_app has BYPASSRLS. Row-level security — the second of the two tenancy layers — does not apply to it. Refusing to deploy.';
  END IF;
  IF r.rolreplication THEN
    RAISE EXCEPTION 'The runtime role ibms_app has REPLICATION. It can read the write-ahead log, which is every row in every table regardless of RLS. Refusing to deploy.';
  END IF;
  IF r.rolcreaterole THEN
    RAISE EXCEPTION 'The runtime role ibms_app has CREATEROLE. It can grant itself membership in any role, including the table owner, and then read past RLS. Refusing to deploy.';
  END IF;
  IF r.rolcreatedb THEN
    RAISE EXCEPTION 'The runtime role ibms_app has CREATEDB. Not a data bypass, but a runtime role has no business creating databases, and its presence means the role was provisioned with more than it was designed for. Refusing to deploy.';
  END IF;

  -- The membership check, which is the one the attributes above miss.
  SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) INTO memberships
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles g      ON g.oid = m.roleid
   WHERE member.rolname = 'ibms_app';

  IF memberships IS NOT NULL THEN
    RAISE EXCEPTION 'The runtime role ibms_app has been granted membership in: %. It inherits those roles'' privileges while rolsuper stays FALSE — and if any of them owns the tables, Postgres exempts it from their RLS policies, so one office can read another''s rows. Measured on a planted grant: 13,774 rows returned where 1 was expected. If a membership is genuinely required, it has to be argued for here. Refusing to deploy.', memberships;
  END IF;
END
$assert$;
