import { Prisma } from '@ibms/db';
import {
  compareMoney,
  formatMoney,
  subtractMoney,
  sumMoney,
  type MoneyInput,
} from '../../common/money.util';
import type { ProfitabilityPolicyRow } from '../../repositories/profitability-policy.repository';

/**
 * Process 63 (backlog Part C #63, Domain G) — "Profitability Analysis:
 * commission income vs. cost-to-serve per segment/line." The seed's own
 * description names the exact framing this process implements
 * (`packages/db/prisma/seed-data/permissions.ts`'s `profitability-analysis.
 * view`). Reads the SAME written-policy data #40's `FinancialReportService`
 * already loads (`ProfitabilityPolicyRepository`, promoted out of
 * `financial-report.repository.ts` once this process needed it too) but
 * reduces it into a DIFFERENT metric:
 *
 *   - `commissionIncomeJod` — Σ (`commissionAmount − commissionReversedAmount`)
 *     per group, the IDENTICAL net-of-clawback `commissionEarned` calculation
 *     #40 already uses (not #58/#61's deliberately-gross "no netting"
 *     simplification — this process needs the precise figure).
 *   - `costToServeJod` — Σ net settlement of the group's SETTLED / CLOSED
 *     claims. **A documented scoped interpretation, not a true operational
 *     cost**: no operational-expense / staff-time / overhead tracking model
 *     exists anywhere in this schema (Domain H / backlog #66, Human
 *     Resources, is not built), so claims-settlement payout — the one real
 *     cost-shaped figure attributable to a line/segment — stands in as the
 *     closest available signal for "what it costs to service this book."
 *     This is the SAME `claimsPaid` figure #40's `netPosition` already
 *     computes, reused rather than duplicated.
 *   - `netProfitabilityJod` = `commissionIncomeJod − costToServeJod` — a
 *     BROKER-centric margin, deliberately different from #40's `netPosition
 *     = premiumWritten − claimsPaid − commissionEarned` (an underwriting-
 *     result view of the INSURER's side of the book). #63 asks a different
 *     question: is the commission the broker earns on this book enough to
 *     cover what it costs to service its claims?
 *
 * Grouped by `insuranceLine` and `customerType` ("segment") ONLY — the
 * backlog names exactly these two dimensions, unlike #62's four. Rows sort
 * worst-first (most-negative `netProfitabilityJod`), the #40 `groupProfitability`
 * convention — surfacing the segments needing attention first.
 */

/** A capped `findMany` (not a DB-side `groupBy`, since `customerType` lives
 * on a joined `Customer` table `groupBy` cannot cross) needs a read-limit —
 * the `PORTFOLIO_ANALYSIS_READ_LIMIT`/`FINANCIAL_REPORT_ROW_LIMIT` shape. */
export const PROFITABILITY_ANALYSIS_READ_LIMIT = 5000;

export interface ProfitabilityBreakdownRow {
  key: string;
  commissionIncomeJod: string;
  costToServeJod: string;
  netProfitabilityJod: string;
  policyCount: number;
  claimCount: number;
}

export interface ProfitabilityAnalysisSummary {
  generatedAt: string;
  byLine: ProfitabilityBreakdownRow[];
  bySegment: ProfitabilityBreakdownRow[];
  totals: Omit<ProfitabilityBreakdownRow, 'key'>;
}

function rowFor(
  policies: ProfitabilityPolicyRow[],
): Omit<ProfitabilityBreakdownRow, 'key'> {
  const zero = new Prisma.Decimal(0);
  const nets = policies.flatMap((p) => p.claimNetSettlements);
  const settledNets = nets.filter((n): n is NonNullable<typeof n> => n != null);
  const costToServe = sumMoney(settledNets);
  const commissionIncome = sumMoney(
    policies.map((p): MoneyInput =>
      subtractMoney(
        p.commissionAmount == null ? zero : p.commissionAmount,
        p.commissionReversedAmount == null ? zero : p.commissionReversedAmount,
      ),
    ),
  );
  return {
    commissionIncomeJod: formatMoney(commissionIncome),
    costToServeJod: formatMoney(costToServe),
    netProfitabilityJod: formatMoney(
      subtractMoney(commissionIncome, costToServe),
    ),
    policyCount: policies.length,
    claimCount: settledNets.length,
  };
}

function groupBy(
  policies: ProfitabilityPolicyRow[],
  keyOf: (p: ProfitabilityPolicyRow) => string,
): ProfitabilityBreakdownRow[] {
  const groups = new Map<string, ProfitabilityPolicyRow[]>();
  for (const p of policies) {
    const key = keyOf(p);
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...rowFor(g) }))
    .sort(
      (a, b) =>
        compareMoney(a.netProfitabilityJod, b.netProfitabilityJod) ||
        a.key.localeCompare(b.key, 'en'),
    );
}

/** Pure: builds the full summary from the raw written-policy rows. */
export function buildProfitabilityAnalysis(
  policies: ProfitabilityPolicyRow[],
): Omit<ProfitabilityAnalysisSummary, 'generatedAt'> {
  return {
    byLine: groupBy(policies, (p) => p.insuranceLine),
    bySegment: groupBy(policies, (p) => p.customerType),
    totals: rowFor(policies),
  };
}
