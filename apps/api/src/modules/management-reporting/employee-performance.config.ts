import type { EmployeePerformanceRecord } from '@ibms/db';
import { Prisma } from '@ibms/db';
import {
  MONEY_ROUNDING,
  formatMoney,
  type MoneyInput,
} from '../../common/money.util';
import {
  previousUtcMonthRange,
  type PeriodWindow,
} from '../../common/period.util';

// Re-exported so `./employee-performance.config` importers don't also need
// `common/period.util.ts` directly — the `insurer-performance.config.ts`
// re-export shape.
export { previousUtcMonthRange, type PeriodWindow };

/**
 * Process 61 (backlog Part C #61, Domain G) — "Employee Performance:
 * `EmployeePerformanceRecord`, a periodic job: new clients/premium/
 * commission/renewal rate/cross-sell rate." Like #60, `EmployeePerformance
 * Record` already exists in the core schema — this process is its first
 * real consumer, alongside `Employee` and `User.employeeId` (both dormant
 * elsewhere — Domain H/#66 HR is not built, so no application code has
 * ever created an `Employee` row or linked a `User` to one). See
 * `ibms-brain/meta/context/employee-performance.md` for the full
 * per-metric reasoning.
 */

export interface EmployeePerformanceRecordView {
  id: string;
  employeeId: string;
  /**
   * ITEM 1 — the colleague's name from their HR record, resolved by the api through
   * `EmployeeRepository.namesForEmployeeIds`.
   *
   * REQUIRED on the view and never optional: it is read by `/dashboards/insurer-employee-performance`
   * and projected by three service methods, and an optional field would let one of them keep
   * sending nothing while the others carried a name — a name after a LIST and none after a COMPUTE,
   * which is the `IncidentReport.load()` defect and is invisible to a test that only lists.
   *
   * NULLABLE because a performance record is a periodic SNAPSHOT and can outlive the employee row
   * it scores. A missing row reports NO NAME, never the uuid.
   */
  employeeName: string | null;
  periodLabel: string;
  newClients: number | null;
  premiumWrittenJod: string | null;
  commissionEarnedJod: string | null;
  renewalRatePercent: string | null;
  crossSellRatePercent: string | null;
}

/** Pure: a resolved outcome count -> a 0-100 rate, or `null` when the
 * denominator is zero — "no outcomes existed to rate this period" is a
 * genuinely different fact from "0% succeeded," and `EmployeePerformance
 * Record.renewalRatePercent`/`crossSellRatePercent` are nullable columns
 * specifically to let that distinction survive into storage. */
export function ratePercentOrNull(
  succeeded: number,
  total: number,
): Prisma.Decimal | null {
  if (total === 0) return null;
  return new Prisma.Decimal(succeeded)
    .dividedBy(total)
    .times(100)
    .toDecimalPlaces(2, MONEY_ROUNDING);
}

/** Pure: a possibly-null money aggregate -> a fixed 3dp JOD string, or
 * `null` through unchanged (unlike `kpi-dashboard.config.ts`'s
 * `formatMoneySum`, which renders a null aggregate as "0.000" — here
 * `null` never occurs for `premiumWritten`/`commissionEarned` in practice,
 * since the service always passes a real, possibly-zero `Prisma.Decimal`;
 * this stays defensive rather than assuming that invariant everywhere). */
export function formatMoneyOrNull(value: MoneyInput | null): string | null {
  return value === null ? null : formatMoney(value);
}

export function deriveEmployeePerformanceRecordView(
  row: EmployeePerformanceRecord,
  /** Resolved by `EmployeeRepository.namesForEmployeeIds`. A REQUIRED parameter, so the compiler
   * names every call site — it named three plus the spec. */
  employeeNames: Map<string, string>,
): EmployeePerformanceRecordView {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: employeeNames.get(row.employeeId) ?? null,
    periodLabel: row.periodLabel,
    newClients: row.newClients,
    premiumWrittenJod: formatMoneyOrNull(row.premiumWritten),
    commissionEarnedJod: formatMoneyOrNull(row.commissionEarned),
    renewalRatePercent: row.renewalRatePercent
      ? row.renewalRatePercent.toFixed(2)
      : null,
    crossSellRatePercent: row.crossSellRatePercent
      ? row.crossSellRatePercent.toFixed(2)
      : null,
  };
}
