/**
 * LAYER 1's INSTRUMENTATION — what the duplicate-name warning actually did.
 *
 *     node scripts/measurements/duplicate-name-warnings.mjs            # dev
 *     DATABASE_URL=<db-test url> node scripts/measurements/duplicate-name-warnings.mjs
 *
 * This exists because the owner's decision on layer 2 (a KEYED fingerprint of the identity number,
 * deferred) is to be settled by a NUMBER rather than by argument, and the number has to be collected
 * from the day layer 1 ships. Its wake condition is written down rather than left open:
 *
 *     "layer 2 wakes when A DUPLICATE IS DISCOVERED THAT THE NAME CHECK DID NOT WARN ABOUT"
 *
 * so what this script reports is not "is layer 1 working" but the three figures that bear on whether
 * the name check is the right instrument at all.
 *
 * ## Why four numbers and not one
 *
 * `fired` alone cannot decide anything, and the two ways it misleads pull in opposite directions:
 *
 *   - FORTY WARNINGS ON ONE NAME is a data-entry problem (somebody re-entering the same customer), and
 *     a fingerprint would not help. FORTY ON FORTY NAMES is a duplicate problem, and it would. The two
 *     produce the same `fired`, which is why `distinctNames` sits beside it.
 *   - `heeded` is the warning WORKING — an officer recognised the person and wrote nothing. Those rows
 *     carry no customer id, and that null is the finding: a boolean on `Customer` could not have held
 *     them, so this is the half of the measurement that would have been lost by the cheaper design.
 *   - `proceeded` is layer 1 declining to prevent, which is its design (two real people share a name).
 *     It is only evidence AGAINST the name check when real duplicates keep appearing alongside it.
 *
 * ## What this script cannot answer
 *
 * It cannot tell a `proceeded` row that was a correct judgement from one that was a mistake. Nothing
 * can, from inside the system — that is what the wake condition is for, and it is triggered by a
 * duplicate somebody FINDS, not by a figure here crossing a line.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function pct(part, whole) {
  if (whole === 0) return '  n/a';
  return `${((part / whole) * 100).toFixed(1).padStart(5)}%`;
}

async function main() {
  const [fired, heeded, proceeded, distinct, byOfficer] = await Promise.all([
    prisma.duplicateNameWarning.count(),
    // The warning worked: answered "same person" AND no customer was written.
    prisma.duplicateNameWarning.count({
      where: { samePerson: true, createdCustomerId: null },
    }),
    // Answered "a different person" and the create went through.
    prisma.duplicateNameWarning.count({
      where: { samePerson: false, createdCustomerId: { not: null } },
    }),
    prisma.duplicateNameWarning.findMany({
      distinct: ['canonicalKey'],
      select: { canonicalKey: true },
    }),
    prisma.duplicateNameWarning.groupBy({
      by: ['actorUserId'],
      _count: { _all: true },
    }),
  ]);

  // A THIRD OUTCOME EXISTS AND IS NOT ONE OF THE TWO ABOVE: "same person" with a customer id, meaning
  // somebody answered that it was the same person and created the row anyway. Reported separately
  // rather than folded into `proceeded`, because it is a different act — the first is a judgement the
  // warning invited, the second is a judgement the warning contradicted.
  const createdAnyway = await prisma.duplicateNameWarning.count({
    where: { samePerson: true, createdCustomerId: { not: null } },
  });

  console.log('LAYER 1 — duplicate-name warning');
  console.log('='.repeat(72));
  console.log(`  warnings shown                      ${String(fired).padStart(6)}`);
  console.log(`  distinct names warned about         ${String(distinct.length).padStart(6)}`);
  console.log(`  officers who saw one                ${String(byOfficer.length).padStart(6)}`);
  console.log('');
  console.log('  outcome');
  console.log(
    `    heeded — nothing created          ${String(heeded).padStart(6)}  ${pct(heeded, fired)}`,
  );
  console.log(
    `    different person — created        ${String(proceeded).padStart(6)}  ${pct(proceeded, fired)}`,
  );
  console.log(
    `    same person — created ANYWAY      ${String(createdAnyway).padStart(6)}  ${pct(createdAnyway, fired)}`,
  );
  console.log('');

  if (fired === 0) {
    console.log(
      '  NOTHING TO READ YET. Zero warnings is not evidence the check works — it is also what a broken\n' +
        '  lookup looks like, and what an office that has created no customers since the warning shipped\n' +
        '  looks like. Before concluding anything, verify the route answers at all:\n' +
        '    GET /customers/duplicate-name-check?legalName=<a name you know exists>',
    );
  } else if (distinct.length === 1) {
    console.log(
      '  ONE NAME accounts for every warning — that is a data-entry pattern, not a duplicate problem,\n' +
        '  and a fingerprint layer would not address it.',
    );
  }

  if (createdAnyway > 0) {
    console.log(
      `  ${createdAnyway} row(s) say "same person" AND created a customer. Each one is a duplicate somebody\n` +
        '  created knowingly — worth reading individually rather than counting.',
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
