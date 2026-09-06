import {
  compareMoney,
  formatMoney,
  formatMoneySum,
  sumMoney,
  type MoneyInput,
} from '../../common/money.util';
import type {
  LineOrInsurerGroup,
  PolicyForCrossTableGrouping,
} from '../../repositories/portfolio-analysis.repository';

/**
 * Process 62 (backlog Part C #62, Domain G) — "Portfolio Analysis: a query
 * by line/insurer/client segment/geography." The backlog names no model and
 * no metric — scoped to the same two figures per breakdown every other
 * cross-cutting reporting module in this codebase already uses: a policy
 * count and a total issued premium sum, over the whole ISSUED book (the
 * `kpi-dashboard.md` `totalIssuedPremiumJod` inclusion rule — `issuedPremium
 * IS NOT NULL`, no further date scoping; a "portfolio" is a current-state
 * snapshot, not a periodic job like #60/#61).
 *
 * `insuranceLine`/`insurerId` live on `Policy` itself, so those two
 * breakdowns are genuine DB-side `groupBy` calls. `Customer.customerType`
 * ("client segment") and `Branch.name` (via the customer-owning Sales
 * Officer's `User.branchId` — "geography": the only structured,
 * low-cardinality location-like field anywhere in this schema; a
 * `Customer.registeredAddress` is free text) live on a JOINED table
 * Prisma's `groupBy` cannot cross, so those two are a capped `findMany`
 * reduced here in pure JS — the `SlaDashboardRepository`/
 * `InternalControlsService` shape. See `ibms-brain/meta/context/
 * portfolio-analysis.md`.
 */

/** A capped `findMany` (not a DB-side `groupBy`) needs a read-limit — the
 * `SLA_DASHBOARD_TIMER_LIMIT` shape/value. Only the two cross-table
 * breakdowns (client segment, geography) use this; `byLine`/`byInsurer` are
 * real `groupBy` calls with no such limit. */
export const PORTFOLIO_ANALYSIS_READ_LIMIT = 5000;

/** A customer whose owning Sales Officer has no `branchId` on file. */
export const UNASSIGNED_GEOGRAPHY_LABEL = 'Unassigned';

export interface PortfolioBreakdownRow {
  key: string;
  policyCount: number;
  totalIssuedPremiumJod: string;
}

export interface PortfolioAnalysisSummary {
  generatedAt: string;
  byLine: PortfolioBreakdownRow[];
  byInsurer: PortfolioBreakdownRow[];
  byClientSegment: PortfolioBreakdownRow[];
  byGeography: PortfolioBreakdownRow[];
}

/** Pure: descending by total premium — the largest slice of the book
 * first, the natural reading order for a portfolio breakdown. */
function sortByPremiumDesc(
  rows: PortfolioBreakdownRow[],
): PortfolioBreakdownRow[] {
  return [...rows].sort((a, b) =>
    compareMoney(b.totalIssuedPremiumJod, a.totalIssuedPremiumJod),
  );
}

/** Pure: `byLine`/`byInsurer` — a real `groupBy` result, with an optional
 * id -> display-name resolution (insurer names; `byLine`'s `insuranceLine`
 * is already a display-ready string, so no map is passed for it). */
export function deriveLineOrInsurerBreakdown(
  rows: LineOrInsurerGroup[],
  nameById?: Map<string, string>,
): PortfolioBreakdownRow[] {
  const mapped = rows.map((r) => ({
    key: nameById ? (nameById.get(r.key) ?? r.key) : r.key,
    policyCount: r.policyCount,
    totalIssuedPremiumJod: formatMoneySum(r.totalIssuedPremium),
  }));
  return sortByPremiumDesc(mapped);
}

/** Pure: groups the capped policy list by `Customer.customerType`. */
export function reduceByClientSegment(
  rows: PolicyForCrossTableGrouping[],
): PortfolioBreakdownRow[] {
  return reduceByKey(rows, (r) => r.customerType);
}

/** Pure: groups the capped policy list by the owning Sales Officer's
 * branch name, `UNASSIGNED_GEOGRAPHY_LABEL` when they have none on file. */
export function reduceByGeography(
  rows: PolicyForCrossTableGrouping[],
  branchNameByOwner: Map<string, string | null>,
): PortfolioBreakdownRow[] {
  return reduceByKey(
    rows,
    (r) => branchNameByOwner.get(r.ownerUserId) ?? UNASSIGNED_GEOGRAPHY_LABEL,
  );
}

function reduceByKey(
  rows: PolicyForCrossTableGrouping[],
  keyOf: (row: PolicyForCrossTableGrouping) => string,
): PortfolioBreakdownRow[] {
  const byKey = new Map<string, MoneyInput[]>();
  const countByKey = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    const premiums = byKey.get(key) ?? [];
    premiums.push(row.issuedPremium);
    byKey.set(key, premiums);
  }
  const result = [...byKey.entries()].map(([key, premiums]) => ({
    key,
    policyCount: countByKey.get(key)!,
    totalIssuedPremiumJod: formatMoney(sumMoney(premiums)),
  }));
  return sortByPremiumDesc(result);
}
