/**
 * 🔴 DOES THE OFFICE'S INVOICE LIST ANSWER, AND DOES EVERY ROW CARRY A NAME? — asked of the
 * SEEDED DATABASE, not of a fixture.
 *
 * Decision 167/13 puts a finance invoice screen in front of Ahmad, and the whole of it is that no
 * uuid is typed or shown: every row names its customer, its policy and its insurer. The unit tests
 * prove the mapper and the filter over fixtures; what they cannot prove is that the Prisma query
 * this adds actually resolves those three joins over real rows.
 *
 * ⚠️ AND THE api e2e THAT WOULD NORMALLY ANSWER THIS CANNOT RUN ON THE AUTHORING MACHINE — the
 * db-test `ibms_app` credentials fail there, which is exactly how #80 reached CI twice. So this is
 * the local stand-in, and it is run before the screen is built rather than after.
 *
 * ## What it checks
 *
 *   - the book-wide page answers at all, with a total from the same filter
 *   - EVERY row names its customer; and where a row has a policy, it names the policy and insurer
 *   - the «open» filter is a strict subset of «everything», and names which statuses it dropped
 *   - the insurer filter returns only that insurer's rows
 *   - ⛔ and no row's display value is a uuid, which is the ruling itself, checked rather than
 *     assumed
 *
 * ## Run it
 *
 *   npx dotenv -e .env -- npx tsx scripts/measurements/invoice-list-page.ts
 *
 * Reads `.env`, the dev database. It opens no transaction and writes nothing.
 */
import { PrismaClient } from '@ibms/db';

const prisma = new PrismaClient();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPEN = [
  'INVOICED',
  'COLLECTED',
  'RECONCILED',
  'EXCEPTION_RAISED',
  'EXCEPTION_RESOLVED',
] as const;

const INCLUDE = {
  receipts: { orderBy: { receivedAt: 'asc' }, include: { remittance: true } },
  customer: { select: { id: true, legalName: true } },
  policy: {
    select: {
      id: true,
      policyNumber: true,
      insurer: {
        select: {
          id: true,
          legalName: true,
          legalNameAr: true,
          insurerMaster: { select: { legalName: true, legalNameAr: true } },
          insuranceCompany: { select: { legalName: true, legalNameAr: true } },
        },
      },
    },
  },
} as const;

async function main(): Promise<void> {
  const all = await prisma.invoice.count();
  console.log(`invoices on this database: ${all}`);
  if (all === 0) {
    console.log('\n⚠️  NO INVOICES — this run is VACUOUS and proves nothing.');
    return;
  }

  const [rows, total] = await prisma.$transaction([
    prisma.invoice.findMany({
      where: { status: { in: [...OPEN] } },
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 50,
    }),
    prisma.invoice.count({ where: { status: { in: [...OPEN] } } }),
  ]);
  console.log(`open page: ${rows.length} rows, total ${total}`);

  /*
   * THE «OPEN» FILTER IS A STRICT SUBSET, AND WHAT IT DROPS IS NAMED. A filter that happened to
   * match everything would make every assertion below pass while proving nothing about it.
   */
  const dropped = await prisma.invoice.groupBy({
    by: ['status'],
    where: { status: { notIn: [...OPEN] } },
    _count: true,
  });
  console.log(
    `dropped by the open filter: ${
      dropped.length === 0
        ? '(nothing — every invoice is open today, so that half is VACUOUS here)'
        : dropped.map((d) => `${d.status}=${d._count}`).join(', ')
    }`,
  );

  let named = 0;
  let withPolicy = 0;
  let namedPolicy = 0;
  let namedInsurer = 0;
  const uuidsOnDisplay: string[] = [];

  for (const row of rows) {
    if (row.customer.legalName.trim()) named += 1;
    if (UUID.test(row.customer.legalName)) uuidsOnDisplay.push(row.customer.legalName);
    if (row.policy) {
      withPolicy += 1;
      if (row.policy.policyNumber?.trim()) namedPolicy += 1;
      if (row.policy.policyNumber && UUID.test(row.policy.policyNumber)) {
        uuidsOnDisplay.push(row.policy.policyNumber);
      }
      const insurer = row.policy.insurer;
      const name =
        insurer.insurerMaster?.legalName ??
        insurer.insuranceCompany?.legalName ??
        insurer.legalName;
      if (name?.trim()) namedInsurer += 1;
      if (name && UUID.test(name)) uuidsOnDisplay.push(name);
    }
  }

  console.log(`\ncustomers named : ${named} of ${rows.length}`);
  console.log(`rows with a policy: ${withPolicy} of ${rows.length}`);
  console.log(`  policy numbers named : ${namedPolicy} of ${withPolicy}`);
  console.log(`  insurers named       : ${namedInsurer} of ${withPolicy}`);
  console.log(
    `\n⛔ uuid used as a DISPLAY value: ${
      uuidsOnDisplay.length === 0 ? 'none' : uuidsOnDisplay.join(', ')
    }`,
  );

  // THE INSURER FILTER, over an insurer the data actually has.
  const anInsurer = rows.find((r) => r.policy)?.policy?.insurer.id ?? null;
  if (anInsurer === null) {
    console.log(
      '\n⚠️  no row on this page carries a policy, so the INSURER FILTER is UNMEASURED here.',
    );
  } else {
    const filtered = await prisma.invoice.findMany({
      where: { policy: { insurerId: anInsurer } },
      include: INCLUDE,
      take: 50,
    });
    const foreign = filtered.filter(
      (r) => r.policy?.insurer.id !== anInsurer,
    ).length;
    console.log(
      `\ninsurer filter on ${anInsurer}: ${filtered.length} rows, ${foreign} belonging to another insurer`,
    );
    // AND AN INVOICE WITH NO POLICY CAN NEVER MATCH IT — the nested relation filter's own
    // consequence, which is correct: such an invoice has no insurer to remit to.
    const noPolicy = await prisma.invoice.count({ where: { policyId: null } });
    console.log(
      `invoices with no policy at all: ${noPolicy} (none of them can match an insurer filter, by design)`,
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
