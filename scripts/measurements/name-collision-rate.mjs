/**
 * HOW OFTEN WOULD A HARD CANONICAL-NAME CHECK REFUSE A ROW ON IMPORT?
 *
 * The owner decided the import uses canonicalisation as a HARD refusal rather than a warning, because
 * nobody answers two thousand "is this the same person?" questions — and invited an objection with
 * evidence before it is built, on the ground that two real people sharing a name would be refused on
 * import where they are merely queried on the create screen.
 *
 * That asymmetry is only a problem if the collision rate is high enough to make the report unworkable.
 * This measures the rate rather than arguing about it, and measures it the way the import would see it:
 * not "how many groups exist" but "how many ROWS would have been refused" — which is the number an
 * office would be handed.
 *
 *   node scripts/measurements/name-collision-rate.mjs                     (dev)
 *   npx dotenv -e .env.test -- node scripts/measurements/name-collision-rate.mjs
 *
 * Two figures matter and they are not the same:
 *   REFUSED ROWS   every row after the first in each colliding group. What the office must resolve.
 *   GROUP SIZES    whether collisions are pairs or pile-ups. A pair is a judgement; a group of ten is
 *                  a data problem the import should not be asked to arbitrate.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function rows(sql) {
  try {
    return await prisma.$queryRawUnsafe(sql);
  } catch (err) {
    console.log('ERROR:', err.message.split('\n')[0]);
    return [];
  }
}

for (const type of ['INDIVIDUAL', 'CORPORATE']) {
  const total = Number(
    (await rows(`SELECT count(*)::int AS n FROM "Customer" WHERE "customerType" = '${type}'`))[0]
      ?.n ?? 0,
  );
  const groups = await rows(`
    SELECT count(*)::int AS c
    FROM "Customer"
    WHERE "customerType" = '${type}'
    GROUP BY "organizationId", canonical_name_key("legalName")
    HAVING count(*) > 1
    ORDER BY c DESC
  `);
  const sizes = groups.map((g) => Number(g.c));
  // Every row after the first in a group is what a hard check refuses.
  const refused = sizes.reduce((sum, c) => sum + (c - 1), 0);
  const pct = total ? ((refused / total) * 100).toFixed(2) : '0.00';

  console.log(`\n=== ${type}`);
  console.log(`  rows                        ${total}`);
  console.log(`  colliding groups            ${sizes.length}`);
  console.log(`  ROWS A HARD CHECK REFUSES   ${refused}   (${pct}% of the book)`);
  if (sizes.length) {
    console.log(`  largest group               ${sizes[0]}`);
    console.log(`  pairs (group of exactly 2)  ${sizes.filter((c) => c === 2).length}`);
    console.log(`  groups of 3 or more         ${sizes.filter((c) => c >= 3).length}`);
  }
}

// The names themselves, for the individual case — because the RATE alone cannot say whether these are
// two real people or one person entered twice, and that is the whole question.
console.log('\n=== the colliding INDIVIDUAL names, so the rate can be read rather than trusted');
for (const r of await rows(`
  SELECT canonical_name_key("legalName") AS k, count(*)::int AS c,
         string_agg(DISTINCT "legalName", ' | ') AS spellings
  FROM "Customer" WHERE "customerType" = 'INDIVIDUAL'
  GROUP BY "organizationId", canonical_name_key("legalName")
  HAVING count(*) > 1
  ORDER BY c DESC, k
  LIMIT 20
`)) {
  console.log(`  ${String(r.c).padStart(3)}x  ${r.spellings}`);
}

console.log('');
await prisma.$disconnect();
