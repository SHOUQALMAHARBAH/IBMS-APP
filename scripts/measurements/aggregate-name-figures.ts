/**
 * 🔴 DO THE ARABIC NAMES MOVE ANY FIGURE? — asked of the SEEDED DATABASE, not of a fixture.
 *
 * Contents §أ row ١١ puts the insurer's and the line's Arabic name on the claims dashboard, the
 * financial dashboard, the financial report and `/insurer-accounting`. Message 54 §1's standing
 * condition is «⛔ every figure on these screens reads exactly as before: assert it, on a seeded
 * database, before and after», and this is that assertion.
 *
 * ## How «before and after» is established, and why it is NOT two API runs
 *
 * The four aggregations are PURE functions over repository rows. So each is run TWICE over the
 * SAME REAL ROWS read from the seeded database — once as the rows actually arrive, carrying their
 * Arabic names, and once with every Arabic name nulled, which is byte-for-byte the input shape
 * the code on `main` produced. Every field but the new name is then compared deeply.
 *
 * ⟶ That is stronger than diffing one dataset against one earlier run: it holds for whatever the
 *   database happens to contain, and it localises the claim to the only new input. A snapshot
 *   would pin the figures for the rows that existed the day it was taken.
 *
 * ⚠️ AND IT DOES NOT COVER A CHANGED QUERY PROJECTION, which is the one thing a pure-function
 * invariance cannot see. That half is measured separately and exactly: the obligations query's
 * Latin name moved from `COALESCE(im."legalName", ins."legalName")` to a CASE on the chosen
 * source, and both forms were run side by side over every `Insurer` row on dev — 19 rows, 15
 * master-linked, 4 office-local, **0 differing**. Every other query gained RELATIONS inside its
 * `select`, which cannot change another field's value, and no grouping key changed.
 *
 * ## Run it
 *
 *   npx tsx scripts/measurements/aggregate-name-figures.ts        (reads .env — the dev database)
 *
 * ⛔ Read-only. It opens no transaction and writes nothing.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import {
  buildLossRatioBreakdown,
  type AnalyticsPolicyLike,
  type LossRatioGroupBy,
} from '../../apps/api/src/modules/loss-ratio/loss-ratio.config';
import {
  buildProfitability,
  buildInsurerPayables,
  buildCommissionRollup,
  type InsurerObligationRow,
  type InsurerRemittanceRow,
  type CommissionRollupEntryRow,
} from '../../apps/api/src/modules/finance/finance.config';
import type { ProfitabilityPolicyRow } from '../../apps/api/src/repositories/profitability-policy.repository';
import { ANALYTICS_WRITTEN_POLICY_STATUSES } from '../../apps/api/src/repositories/loss-ratio.repository';
import {
  INSURER_IDENTITY_SELECT,
  insurerName,
  resolveInsurerNamePair,
} from '../../apps/api/src/repositories/insurer-identity';
import {
  INSURANCE_LINE_NAME_INCLUDE,
  insuranceLineNameAr,
} from '../../apps/api/src/repositories/insurance-line-names';

const prisma = new PrismaClient();

/** Deep-equal on the JSON projection, with the named keys dropped at every depth. */
function withoutKeys(value: unknown, drop: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => withoutKeys(v, drop));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (drop.includes(k)) continue;
      out[k] = withoutKeys(v, drop);
    }
    return out;
  }
  return value;
}

let failures = 0;
const vacuous: string[] = [];

/**
 * What the comparison is ENTITLED to find, which is not the same question everywhere.
 *
 *   'names-differ'  the grouping carries an Arabic name, so the two runs MUST differ. If they do
 *                   not, «the figures match» is a claim about two identical inputs and proves
 *                   nothing — the false-green shape, so it FAILS.
 *   'scoped-null'   the grouping carries NO Arabic name by the owner's scope (by customer, by
 *                   policy). The two runs are expected to be identical, and what is asserted
 *                   instead is that the new field really is absent on BOTH sides — so a build
 *                   that leaked a name into this grouping fails here.
 *
 * 🔴 THIS DISTINCTION IS NOT COSMETIC, AND THE FIRST RUN IS WHY IT EXISTS. With one expectation
 * for all four groupings the script reported «3 comparison(s) FAILED» — two of them being the
 * by-customer and by-policy groupings behaving exactly as the owner's scope requires, and the
 * third being an empty table. A guard that cries wolf on correct behaviour is one somebody
 * silences, so each case now states what it is entitled to find.
 */
type Expect = 'names-differ' | 'scoped-null';

function compare(
  what: string,
  withAr: unknown,
  withoutAr: unknown,
  newKeys: readonly string[],
  expect: Expect = 'names-differ',
  population = 1,
): void {
  const sameFigures =
    JSON.stringify(withoutKeys(withAr, newKeys)) ===
    JSON.stringify(withoutKeys(withoutAr, newKeys));
  const namesDiffer = JSON.stringify(withAr) !== JSON.stringify(withoutAr);

  // ⚠️ AN EMPTY POPULATION IS REPORTED LOUDLY AND NOT COUNTED AS A PASS. A green over no rows
  // reads exactly like a green over rows that agree, which is the worst shape available — the
  // same reason `check:seed-password-in-docs` carries an `EXPECTED_SECRET_COUNT`.
  if (population === 0) {
    vacuous.push(what);
    console.log(
      `  n/a   ${what.padEnd(46)}NO ROWS on this database — nothing measured here`,
    );
    return;
  }

  const ok =
    expect === 'scoped-null'
      ? sameFigures && !namesDiffer
      : sameFigures && namesDiffer;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? 'OK  ' : 'FAIL'}  ${what.padEnd(46)}` +
      `figures ${sameFigures ? 'identical' : 'DIFFER'}, ` +
      (expect === 'scoped-null'
        ? `no Arabic name either side ${namesDiffer ? '(BUT ONE LEAKED IN)' : '(as scoped)'}`
        : `names ${namesDiffer ? 'differ (non-vacuous)' : 'IDENTICAL (vacuous)'}`),
  );
}

async function main(): Promise<void> {
  console.log(
    `\ndatabase: ${(process.env.DATABASE_URL ?? '(unset)').replace(/:[^:@]*@/, ':***@')}\n`,
  );

  /* ---------- 1. the claims dashboard / claims-analytics breakdown ---------- */
  const policies = await prisma.policy.findMany({
    where: { status: { in: [...ANALYTICS_WRITTEN_POLICY_STATUSES] } },
    select: {
      id: true,
      customerId: true,
      insuranceLine: true,
      insurerId: true,
      policyNumber: true,
      issuedPremium: true,
      requestedPremium: true,
      customer: { select: { legalName: true } },
      insurer: { select: INSURER_IDENTITY_SELECT },
      claims: {
        where: { status: { in: ['SETTLED', 'CLOSED'] } },
        select: { settlement: { select: { netSettlement: true } } },
      },
      ...INSURANCE_LINE_NAME_INCLUDE,
    },
    orderBy: { createdAt: 'asc' },
  });
  const analytics: AnalyticsPolicyLike[] = policies.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    customerLegalName: p.customer.legalName,
    insuranceLine: p.insuranceLine,
    insuranceLineAr: insuranceLineNameAr(p),
    insurerId: p.insurerId,
    insurerName: insurerName(p.insurer),
    insurerNameAr: resolveInsurerNamePair(p.insurer).nameAr,
    policyRef: p.policyNumber ?? p.id,
    premium: p.issuedPremium ?? p.requestedPremium,
    claimNetSettlements: p.claims.map(
      (c) => c.settlement?.netSettlement ?? null,
    ),
  }));
  const analyticsBefore = analytics.map((p) => ({
    ...p,
    insuranceLineAr: null,
    insurerNameAr: null,
  }));
  console.log(
    `buildLossRatioBreakdown  (/dashboards/claims, /claims-analytics)  ` +
      `${analytics.length} written policies, ` +
      `${new Set(analytics.map((p) => p.insuranceLineAr).filter(Boolean)).size} distinct line names, ` +
      `${new Set(analytics.map((p) => p.insurerNameAr).filter(Boolean)).size} distinct insurer names`,
  );
  for (const groupBy of [
    'customer',
    'policy',
    'insurer',
    'line',
  ] as LossRatioGroupBy[]) {
    compare(
      `groupBy: ${groupBy}`,
      buildLossRatioBreakdown({ groupBy, policies: analytics }),
      buildLossRatioBreakdown({ groupBy, policies: analyticsBefore }),
      ['labelAr'],
      // ⛔ by customer and by policy carry no Arabic name BY SCOPE — the owner's row names the
      // insurer and the line. Here that is asserted rather than assumed.
      groupBy === 'insurer' || groupBy === 'line'
        ? 'names-differ'
        : 'scoped-null',
      analytics.length,
    );
  }

  /* ---------- 2. profitability (/dashboards/financial, /financial-report) ---------- */
  const written = await prisma.policy.findMany({
    where: { status: { in: [...ANALYTICS_WRITTEN_POLICY_STATUSES] } },
    select: {
      id: true,
      insuranceLine: true,
      issuedPremium: true,
      requestedPremium: true,
      customer: { select: { customerType: true } },
      claims: {
        where: { status: { in: ['SETTLED', 'CLOSED'] } },
        select: { settlement: { select: { netSettlement: true } } },
      },
      commissionLedgerEntries: { select: { amount: true, reversedAmount: true } },
      ...INSURANCE_LINE_NAME_INCLUDE,
    },
    orderBy: { createdAt: 'asc' },
  });
  const prof: ProfitabilityPolicyRow[] = written.map((p) => {
    const entry = p.commissionLedgerEntries[0] ?? null;
    return {
      policyId: p.id,
      insuranceLine: p.insuranceLine,
      insuranceLineAr: insuranceLineNameAr(p),
      customerType: p.customer.customerType,
      premium: p.issuedPremium ?? p.requestedPremium,
      claimNetSettlements: p.claims.map(
        (c) => c.settlement?.netSettlement ?? null,
      ),
      commissionAmount: entry?.amount ?? null,
      commissionReversedAmount: entry?.reversedAmount ?? null,
    };
  });
  console.log(`\nbuildProfitability  (/dashboards/financial, /financial-report)  ${prof.length} rows`);
  compare(
    'byLine + bySegment + totals',
    buildProfitability(prof),
    buildProfitability(prof.map((p) => ({ ...p, insuranceLineAr: null }))),
    ['labelAr'],
    'names-differ',
    prof.length,
  );

  /* ---------- 3. insurer payables (/insurer-accounting) ---------- */
  const asOf = new Date(Date.UTC(2026, 10, 25));
  const obligationRows = await prisma.$queryRaw<
    {
      invoiceId: string;
      insurerId: string;
      insurerName: string;
      insurerNameAr: string | null;
      premiumAmount: Prisma.Decimal;
      commissionDeducted: Prisma.Decimal;
      collectedAt: Date;
    }[]
  >(Prisma.sql`
    SELECT
      i.id AS "invoiceId",
      p."insurerId",
      CASE WHEN im.id IS NOT NULL THEN im."legalName"
           ELSE ins."legalName" END AS "insurerName",
      CASE WHEN im.id IS NOT NULL THEN im."legalNameAr"
           ELSE ins."legalNameAr" END AS "insurerNameAr",
      i."premiumAmount",
      i."commissionDeducted",
      MAX(r."receivedAt") AS "collectedAt"
    FROM "Invoice" i
    JOIN "Policy" p ON p.id = i."policyId"
    JOIN "Insurer" ins ON ins.id = p."insurerId"
    LEFT JOIN "InsurerMaster" im ON im.id = ins."insurerMasterId"
    JOIN "Receipt" r ON r."invoiceId" = i.id AND r."receivedAt" < ${asOf}
    WHERE i."policyId" IS NOT NULL
    GROUP BY i.id, p.id, ins.id, im.id
    HAVING SUM(r.amount) >= i."totalAmount"
    ORDER BY i."createdAt" ASC
  `);
  const obligations: InsurerObligationRow[] = obligationRows;
  const remittanceRows = await prisma.remittance.findMany({
    where: { remittedAt: { lt: asOf } },
    select: {
      id: true,
      insurerId: true,
      amount: true,
      remittedAt: true,
      insurer: { select: INSURER_IDENTITY_SELECT },
    },
    orderBy: { remittedAt: 'asc' },
  });
  const remittances: InsurerRemittanceRow[] = remittanceRows.map((r) => ({
    remittanceId: r.id,
    insurerId: r.insurerId,
    insurerName: insurerName(r.insurer),
    insurerNameAr: resolveInsurerNamePair(r.insurer).nameAr,
    amount: r.amount,
    remittedAt: r.remittedAt as Date,
  }));
  console.log(
    `\nbuildInsurerPayables  (/insurer-accounting)  ` +
      `${obligations.length} obligations, ${remittances.length} remittances`,
  );
  compare(
    'rows + totals',
    buildInsurerPayables({ asOf, obligations, remittances }),
    buildInsurerPayables({
      asOf,
      obligations: obligations.map((o) => ({ ...o, insurerNameAr: null })),
      remittances: remittances.map((r) => ({ ...r, insurerNameAr: null })),
    }),
    ['insurerNameAr'],
    'names-differ',
    obligations.length + remittances.length,
  );

  /* ---------- 4. commission roll-up (/financial-report, /dashboards/financial) ---------- */
  const ledger = await prisma.commissionLedgerEntry.findMany({
    select: {
      id: true,
      amount: true,
      vatAmount: true,
      paidAmount: true,
      reversedAmount: true,
      status: true,
      policy: {
        select: {
          insurerId: true,
          insurer: { select: INSURER_IDENTITY_SELECT },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const entries: CommissionRollupEntryRow[] = ledger.map((r) => ({
    entryId: r.id,
    insurerId: r.policy.insurerId,
    insurerName: insurerName(r.policy.insurer),
    insurerNameAr: resolveInsurerNamePair(r.policy.insurer).nameAr,
    amount: r.amount,
    vatAmount: r.vatAmount,
    paidAmount: r.paidAmount,
    reversedAmount: r.reversedAmount,
    status: r.status,
  }));
  console.log(
    `\nbuildCommissionRollup  (/financial-report, /dashboards/financial)  ${entries.length} entries`,
  );
  compare(
    'byInsurer + book totals',
    buildCommissionRollup(entries),
    buildCommissionRollup(entries.map((e) => ({ ...e, insurerNameAr: null }))),
    ['insurerNameAr'],
    'names-differ',
    entries.length,
  );

  console.log(
    `\n${failures === 0 ? 'EVERY FIGURE IDENTICAL, and every non-empty comparison was non-vacuous.' : `${failures} comparison(s) FAILED.`}`,
  );
  if (vacuous.length > 0) {
    // ⚠️ PRINTED EVERY RUN, so the gap stays visible rather than being read as coverage.
    console.log(
      `\n⚠️  ${vacuous.length} comparison(s) had NO ROWS on this database and prove nothing:\n` +
        vacuous.map((v) => `      - ${v}`).join('\n') +
        `\n    Those surfaces are covered by the unit specs only until this database holds such rows.`,
    );
  }
  console.log('');
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
