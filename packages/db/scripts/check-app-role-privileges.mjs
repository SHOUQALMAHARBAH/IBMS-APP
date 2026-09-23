#!/usr/bin/env node
/**
 * The runtime role must hold nothing that lets it read past row-level security.
 *
 * ## The path this exists for
 *
 * `tenant-isolation.e2e-spec.ts` asserted that `ibms_app` has no SUPERUSER and no BYPASSRLS. True,
 * and not enough — neither attribute is the only route:
 *
 *     GRANT ibms TO ibms_app;     -- rolsuper stays FALSE
 *
 * The runtime role then inherits the OWNER's privileges, and **Postgres exempts a table's owner
 * from its own RLS policies.** Planted on db-test: `rolsuper` stayed `false`, every existing
 * assertion kept passing, and an unfiltered cross-office read returned **13,774 rows where 1 was
 * expected**, across two offices instead of one. That is the one path that could leak another
 * office's data, and it leaves no mark on the columns a reviewer checks.
 *
 * ## Why a script AND a migration
 *
 * Migration `20261018100000` carries the same assertion, because a migration executes on the
 * database being DEPLOYED to, which is the one a test never sees. But a migration runs **once** —
 * it catches a grant that already existed, never one made afterwards by a DBA, a provisioning
 * script, or a later migration.
 *
 * This is the recurring half. Run against whatever `DATABASE_URL` names, wired into
 * `scripts/verify.sh` and CI beside the checksum and divergence gates.
 *
 * ## Whole set, not named exclusions
 *
 * Memberships are asserted as EMPTY rather than as "not these ones". A membership that is
 * genuinely needed then has to be argued for by editing this file, which is the point — the
 * alternative is an allow-list that grows quietly.
 */
import { PrismaClient } from '@prisma/client';

const APP_ROLE = process.env.APP_DB_ROLE ?? 'ibms_app';

/** Attribute -> why it defeats tenancy. Every one is fatal; the reason is what the operator
 *  needs, and a bare "expected false" would send them to the docs. */
const FATAL_ATTRIBUTES = {
  rolsuper:
    'can read past every RLS policy, and can disable the AuditLogEntry immutability triggers with session_replication_role',
  rolbypassrls:
    'row-level security — the second of the two tenancy layers — simply does not apply to it',
  rolreplication:
    'can read the write-ahead log, which is every row in every table regardless of RLS',
  rolcreaterole:
    'can grant itself membership in any role, including the table owner, and then read past RLS',
  rolcreatedb:
    'has no business creating databases; its presence means the role was provisioned with more than it was designed for',
};

const prisma = new PrismaClient();
try {
  const roles = await prisma.$queryRawUnsafe(
    `SELECT rolsuper, rolbypassrls, rolreplication, rolcreaterole, rolcreatedb
       FROM pg_roles WHERE rolname = $1`,
    APP_ROLE,
  );

  if (roles.length === 0) {
    // Not a failure — see the migration's own note. The application reports this at boot, and it
    // is a different problem (RLS inert) from the one this gate is about (privilege escalation).
    console.log(
      `app role privileges: role "${APP_ROLE}" does not exist on this database — skipping.`,
    );
    console.log(
      '  The application logs an error at boot when APP_DATABASE_URL is unset and it connects as',
    );
    console.log('  the table owner, which makes RLS inert. That is the check for this condition.');
    process.exit(0);
  }

  const role = roles[0];
  const failures = [];

  for (const [attribute, why] of Object.entries(FATAL_ATTRIBUTES)) {
    if (role[attribute] === true) failures.push(`${attribute.toUpperCase()} — it ${why}`);
  }

  const memberships = await prisma.$queryRawUnsafe(
    `SELECT g.rolname AS granted
       FROM pg_auth_members m
       JOIN pg_roles member ON member.oid = m.member
       JOIN pg_roles g      ON g.oid = m.roleid
      WHERE member.rolname = $1
      ORDER BY g.rolname`,
    APP_ROLE,
  );

  if (memberships.length > 0) {
    failures.push(
      `MEMBERSHIP in ${memberships.map((m) => m.granted).join(', ')} — it inherits those roles' ` +
        'privileges while rolsuper stays FALSE, and if any of them owns the tables, Postgres ' +
        'exempts it from their RLS policies, so one office can read another\'s rows',
    );
  }

  console.log(
    `app role privileges: "${APP_ROLE}" — ${Object.keys(FATAL_ATTRIBUTES).length} attributes and ` +
      'membership checked',
  );

  if (failures.length === 0) {
    console.log('  holds nothing that could read past row-level security.');
    process.exit(0);
  }

  console.error(
    `\nTHE RUNTIME ROLE CAN READ PAST ROW-LEVEL SECURITY — tenant isolation is not enforced:\n`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nMeasured on a planted `GRANT ibms TO ibms_app`: an unfiltered cross-office read returned',
  );
  console.error(
    '13,774 rows where 1 was expected, across two offices instead of one — with rolsuper false and',
  );
  console.error(
    'every attribute assertion still green. Revoke it. If a membership is genuinely required, it',
  );
  console.error('has to be argued for in this file rather than granted quietly.');
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
