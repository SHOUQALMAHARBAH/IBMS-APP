#!/usr/bin/env node
/**
 * Multi-tenancy Phase 2 step 8 — create the non-owner database role the API
 * connects as.
 *
 * WHY THIS IS NOT A PRISMA MIGRATION
 * ----------------------------------
 * A Postgres ROLE is cluster-level, not database-level: it is shared by every
 * database on the server, so it does not belong to any one database's migration
 * history. Creating one also needs CREATEROLE, which is a privilege a
 * `prisma migrate deploy` in production should not have to hold. And the role's
 * password is a credential — it must come from the environment, never from SQL
 * committed to the repository.
 *
 * So: this script creates the role and sets its password; the migration
 * (20260928100000_row_level_security) does the GRANTs and the policies, and
 * refuses to run if the role is missing.
 *
 * WHAT THE ROLE IS FOR
 * --------------------
 * Postgres exempts a table's OWNER from that table's own RLS policies. The
 * tables here are owned by the migration role, so if the API connected as that
 * role every policy would be silently inert. `ibms_app` owns nothing and holds
 * only SELECT/INSERT/UPDATE/DELETE, which is exactly what makes the policies
 * apply to it.
 *
 * USAGE
 *   APP_DB_PASSWORD=... node scripts/provision-app-role.mjs
 *   npm run db:provision-app-role
 *
 * Connects using ADMIN_DATABASE_URL if set, otherwise DATABASE_URL. The role it
 * connects as needs CREATEROLE. In CI and in a fresh `docker compose` stack the
 * default `ibms` role is the cluster superuser, so DATABASE_URL is enough; on a
 * database where `ibms` was created by hand as a plain role it is not, and
 * ADMIN_DATABASE_URL (or a one-off `docker exec ... psql -U postgres`) is.
 *
 * Idempotent: re-running updates the password rather than failing.
 */
import { PrismaClient } from '@prisma/client';

const ROLE = process.env.APP_DB_ROLE?.trim() || 'ibms_app';
const PASSWORD = process.env.APP_DB_PASSWORD;
const URL = process.env.ADMIN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

function fail(message) {
  console.error(`\n  provision-app-role: ${message}\n`);
  process.exit(1);
}

if (!URL) fail('neither ADMIN_DATABASE_URL nor DATABASE_URL is set.');
if (!PASSWORD) {
  fail(
    'APP_DB_PASSWORD is not set. This is the password the running API will use, so it has ' +
      'to come from the environment — never from a file in the repository.',
  );
}
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ROLE)) {
  fail(`APP_DB_ROLE "${ROLE}" is not a plain identifier; refusing to interpolate it into SQL.`);
}

// `@prisma/client` rather than `pg`: it is already a dependency here, and this
// repository's lockfile hoisting is load-bearing enough that adding one just
// for a provisioning script is not worth it.
const client = new PrismaClient({ datasources: { db: { url: URL } } });

try {
  const rows = await client.$queryRawUnsafe(
    'SELECT rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user',
  );
  if (!rows[0]?.rolcreaterole && !rows[0]?.rolsuper) {
    fail(
      `the role this script connected as cannot create roles (no CREATEROLE, not a superuser).\n` +
        `  Point ADMIN_DATABASE_URL at a role that can, or run it once by hand:\n\n` +
        `    docker exec <db-container> psql -U postgres -c "CREATE ROLE ${ROLE} LOGIN PASSWORD '<password>'"\n`,
    );
  }

  const exists = await client.$queryRawUnsafe(
    'SELECT 1 AS present FROM pg_roles WHERE rolname = $1',
    ROLE,
  );

  // The password cannot be a bind parameter — CREATE/ALTER ROLE does not accept
  // them — so the SERVER escapes it into a literal, rather than this script
  // attempting the quoting itself.
  const quoted = await client.$queryRawUnsafe(
    'SELECT quote_literal($1) AS q',
    PASSWORD,
  );
  const literal = quoted[0].q;

  if (exists.length > 0) {
    await client.$executeRawUnsafe(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${literal}`);
    console.log(`  Role "${ROLE}" already existed — password updated.`);
  } else {
    await client.$executeRawUnsafe(`CREATE ROLE ${ROLE} WITH LOGIN PASSWORD ${literal}`);
    console.log(`  Created role "${ROLE}".`);
  }

  // Belt and braces: this role must never be able to sidestep the policies.
  //
  // Best-effort, because only a SUPERUSER may set the SUPERUSER/BYPASSRLS
  // attributes at all — and a role created by a mere CREATEROLE holder cannot
  // have been given them in the first place. The verification below is what
  // actually decides, so a failure here is not fatal.
  try {
    await client.$executeRawUnsafe(
      `ALTER ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  } catch {
    await client.$executeRawUnsafe(`ALTER ROLE ${ROLE} NOCREATEDB NOCREATEROLE`);
  }

  const check = await client.$queryRawUnsafe(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    ROLE,
  );
  if (check[0].rolsuper || check[0].rolbypassrls) {
    fail(`"${ROLE}" still has SUPERUSER or BYPASSRLS — it would ignore every policy.`);
  }

  console.log(`  "${ROLE}" is a plain login role: no superuser, no BYPASSRLS, owns nothing.`);
  console.log(`  Next: run the migrations (they GRANT to it and create the policies),`);
  console.log(`  then point APP_DATABASE_URL at it.`);
} catch (err) {
  fail(err.message);
} finally {
  await client.$disconnect().catch(() => undefined);
}
