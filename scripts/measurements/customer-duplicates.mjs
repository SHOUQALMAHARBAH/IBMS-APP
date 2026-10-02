/**
 * DO DUPLICATE CUSTOMERS ALREADY EXIST?
 *
 * Asked BEFORE any unique index is written, because a unique index over data containing duplicates
 * fails the migration itself — and finding that out during a deploy is the expensive way.
 *
 * Run against BOTH databases, because they differ and only one of them is the office's:
 *   node scripts/measurements/customer-duplicates.mjs          (reads .env  — dev)
 *   npx dotenv -e .env.test -- node scripts/.../customer-duplicates.mjs   (db-test)
 *
 * ## What can and cannot be counted
 *
 * COMPANIES are countable exactly: `registrationNumber` is in the clear, so the canonicalised key the
 * owner decided on can be computed here and grouped. `canonical_name_key(text)` is the same IMMUTABLE
 * function backing the insurer unique, so this measures the key that would actually be indexed rather
 * than an approximation of it.
 *
 * PERSONS cannot be counted on their identity number at all. `nationalIdEnc` is encrypted with a random
 * IV per value, so two rows holding the same national ID have different ciphertexts and SQL cannot see
 * that they match. That is the same wall the withdrawn search hit, and it is why the person measurement
 * is by NAME and by the cleartext screening discriminators — which is an UPPER BOUND on name collisions
 * and a LOWER BOUND on real duplicate people, not a count of them. Both directions are stated per row.
 *
 * A name collision is NOT evidence of a duplicate: two real people share a name. The number here is the
 * size of the question layer 1's soft warning would ask, which is the thing worth knowing before
 * building it.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function q(sql) {
  try {
    return await prisma.$queryRawUnsafe(sql);
  } catch (err) {
    return { ERROR: err.message.split('\n')[0] };
  }
}

function show(label, rows, note) {
  if (rows?.ERROR) {
    console.log(`${label.padEnd(52)} ERROR: ${rows.ERROR}`);
    return;
  }
  const n = rows.length ? Number(rows[0].n ?? rows.length) : 0;
  console.log(`${label.padEnd(52)} ${String(n).padStart(6)}${note ? '   ' + note : ''}`);
}

console.log(`\ndatabase: ${(process.env.DATABASE_URL ?? '(unset)').replace(/:[^:@]*@/, ':***@')}\n`);

// Is the canonical key function present at all? Everything corporate below depends on it.
const fn = await q(
  `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'canonical_name_key'`,
);
show('canonical_name_key() present', fn, fn?.ERROR ? '' : '(1 = yes)');

console.log('\n--- TOTALS');
show('customers, all', await q(`SELECT count(*)::int AS n FROM "Customer"`));
show(
  'customers, CORPORATE',
  await q(`SELECT count(*)::int AS n FROM "Customer" WHERE "customerType" = 'CORPORATE'`),
);
show(
  'customers, INDIVIDUAL',
  await q(`SELECT count(*)::int AS n FROM "Customer" WHERE "customerType" = 'INDIVIDUAL'`),
);
show(
  'corporate rows with NO registrationNumber',
  await q(
    `SELECT count(*)::int AS n FROM "Customer"
     WHERE "customerType" = 'CORPORATE'
       AND (("registrationNumber" IS NULL) OR (btrim("registrationNumber") = ''))`,
  ),
  '<- would be UNKEYED under the decision',
);

console.log('\n--- COMPANIES: the key the owner decided on');
show(
  'duplicate groups, EXACT registrationNumber',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", "registrationNumber"
       FROM "Customer"
       WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
       GROUP BY 1, 2 HAVING count(*) > 1
     ) d`,
  ),
);
show(
  'duplicate groups, CANONICALISED',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("registrationNumber") AS k
       FROM "Customer"
       WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
       GROUP BY 1, 2 HAVING count(*) > 1
     ) d`,
  ),
  '<- THE MIGRATION-BLOCKING NUMBER',
);
show(
  'rows inside those canonical groups',
  await q(
    `SELECT COALESCE(sum(c), 0)::int AS n FROM (
       SELECT count(*) AS c
       FROM "Customer"
       WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
       GROUP BY "organizationId", canonical_name_key("registrationNumber")
       HAVING count(*) > 1
     ) d`,
  ),
);
// The interesting half: pairs the canonical key catches that an exact match does not — a number typed
// with a dash one time and without it the next. That difference IS the argument for canonicalising.
show(
  'groups CANONICAL catches but EXACT does not',
  await q(
    `WITH canon AS (
       SELECT "organizationId", canonical_name_key("registrationNumber") AS k, count(*) AS c
       FROM "Customer"
       WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
       GROUP BY 1, 2 HAVING count(*) > 1
     ), exact AS (
       SELECT "organizationId", canonical_name_key("registrationNumber") AS k
       FROM "Customer"
       WHERE "customerType" = 'CORPORATE' AND "registrationNumber" IS NOT NULL
       GROUP BY "organizationId", "registrationNumber", canonical_name_key("registrationNumber")
       HAVING count(*) > 1
     )
     SELECT count(*)::int AS n FROM (
       SELECT k FROM canon EXCEPT SELECT k FROM exact
     ) d`,
  ),
);

console.log('\n--- PERSONS: not countable on the identity number (random IV). Name-based, both bounds.');
show(
  'duplicate groups, CANONICALISED legalName',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("legalName") AS k
       FROM "Customer" WHERE "customerType" = 'INDIVIDUAL'
       GROUP BY 1, 2 HAVING count(*) > 1
     ) d`,
  ),
  '<- size of layer 1 question, NOT duplicates',
);
show(
  'duplicate groups, name + dateOfBirth',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("legalName") AS k, "dateOfBirth"
       FROM "Customer" WHERE "customerType" = 'INDIVIDUAL' AND "dateOfBirth" IS NOT NULL
       GROUP BY 1, 2, 3 HAVING count(*) > 1
     ) d`,
  ),
);
show(
  'duplicate groups, name + dob + nationality',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("legalName") AS k, "dateOfBirth", nationality
       FROM "Customer"
       WHERE "customerType" = 'INDIVIDUAL' AND "dateOfBirth" IS NOT NULL AND nationality IS NOT NULL
       GROUP BY 1, 2, 3, 4 HAVING count(*) > 1
     ) d`,
  ),
  '<- strongest cleartext evidence',
);
show(
  'individuals with NO dateOfBirth',
  await q(
    `SELECT count(*)::int AS n FROM "Customer"
     WHERE "customerType" = 'INDIVIDUAL' AND "dateOfBirth" IS NULL`,
  ),
  '<- invisible to every key above',
);
show(
  'individuals with NO nationalIdEnc',
  await q(
    `SELECT count(*)::int AS n FROM "Customer"
     WHERE "customerType" = 'INDIVIDUAL' AND "nationalIdEnc" IS NULL`,
  ),
  '<- would be UNKEYED under layer 2',
);

console.log('\n--- THE TWO NEIGHBOURS the decision does not mention');
show(
  'UBOs, total',
  await q(`SELECT count(*)::int AS n FROM "UltimateBeneficialOwner"`),
);
show(
  'UBO duplicate groups, canonical fullName',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("fullName") AS k
       FROM "UltimateBeneficialOwner" GROUP BY 1, 2 HAVING count(*) > 1
     ) d`,
  ),
);
show('employees, total', await q(`SELECT count(*)::int AS n FROM "Employee"`));
show(
  'employee duplicate groups, canonical fullName',
  await q(
    `SELECT count(*)::int AS n FROM (
       SELECT "organizationId", canonical_name_key("fullName") AS k
       FROM "Employee" GROUP BY 1, 2 HAVING count(*) > 1
     ) d`,
  ),
);

console.log('');
await prisma.$disconnect();
