import type { Prisma, SalesTarget } from '@ibms/db';

/**
 * Process 59 (backlog Part C #59, Domain G) — "Sales Performance: a query
 * per employee/team against target." The backlog names no model and no
 * target metric — this scopes the target to `targetNewProspects`, the count
 * of `Prospect` rows (a Lead successfully qualified — Process 1->2, the
 * Sales/Relationship Officer's own funnel output) attributable to an
 * employee's `Lead.ownerUserId`/`Prospect.salesOwnerUserId` or to every user
 * in one Branch, created inside the target's `[periodStart, periodEnd)`
 * window. Deliberately NOT premium/commission-based: `Policy.
 * placedByUserId`/`Opportunity.createdByUserId` name the PLACEMENT officer,
 * not the sourcing Sales Officer, and `Customer.prospectId` is optional (a
 * Customer can be onboarded with no Prospect at all) — there is no reliable
 * way to attribute bound premium back to a Sales Officer without guessing.
 * That dimension is `EmployeePerformanceRecord.premiumWritten` (Process 61,
 * a periodic job, not built by this process) — see
 * `ibms-brain/meta/context/sales-performance.md`.
 */

export interface SalesTargetView {
  id: string;
  ownerUserId: string | null;
  branchId: string | null;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  targetNewProspects: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesPerformanceActuals {
  newLeads: number;
  newProspects: number;
}

export interface SalesPerformanceView {
  scope: { ownerUserId: string } | { branchId: string };
  target: SalesTargetView | null;
  actual: SalesPerformanceActuals | null;
  achievementPercent: number | null;
}

/** Pure: a Prisma `SalesTarget` row -> its API view (dates as ISO strings). */
export function deriveSalesTargetView(row: SalesTarget): SalesTargetView {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    branchId: row.branchId,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    targetNewProspects: row.targetNewProspects,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Pure: the audit-row snapshot for a `SalesTarget` write — a distinct,
 * narrower shape from `SalesTargetView` (the `InternalAuditFinding` shape:
 * a dedicated snapshot function, not the API view reused as-is). */
export function salesTargetAuditSnapshot(
  row: SalesTarget,
): Prisma.InputJsonObject {
  return {
    salesTargetId: row.id,
    ownerUserId: row.ownerUserId,
    branchId: row.branchId,
    periodLabel: row.periodLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    targetNewProspects: row.targetNewProspects,
  };
}

/** Pure: exactly one of the two scope fields must be present — an
 * individual quota XOR a team quota, mirroring the DB CHECK
 * (`SalesTarget_owner_xor_branch`) at the validation layer so a bad request
 * 422s before it ever reaches Postgres. */
export function isExactlyOneScope(
  ownerUserId: string | null | undefined,
  branchId: string | null | undefined,
): boolean {
  return Boolean(ownerUserId) !== Boolean(branchId);
}

/** Pure: a percentage, rounded to 2dp — `null` target handling lives in the
 * caller (achievement is undefined with no target set, not a divide-by-zero
 * NaN). */
export function computeAchievementPercent(
  actualNewProspects: number,
  targetNewProspects: number,
): number {
  return Math.round((actualNewProspects / targetNewProspects) * 10000) / 100;
}
