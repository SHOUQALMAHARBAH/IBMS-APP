import type { FigureScope, PeriodWindow } from '../../common/period.util';

export const DEFAULT_RENEWAL_WINDOW_DAYS = 90;

/**
 * Part E — Policy Dashboard (backlog Process #64, Part 13). Bullet text:
 * "active policies, expiring policies (renewal window), new policies
 * issued, cancelled policies and cancellation reasons." `dashboard.policy.
 * view` was already pre-seeded (`[PLACEMENT_TECHNICAL_OFFICER, POLICY_
 * CHECKING_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_MANAGEMENT]`) —
 * see `part-e-dashboards.md`'s header note that Part E IS backlog Process
 * #64's own detail.
 *
 * **Two metrics are a LIVE snapshot, two are period-scoped — a deliberate
 * asymmetry, not an oversight.** "Active policies" and "expiring policies"
 * describe a CURRENT state ("what does the book look like right now"), so
 * they read `Policy.status`/`Policy.expiryDate` as of `now` regardless of
 * the `period` filter. "New policies issued" and "cancelled policies" name
 * an EVENT ("how many became X"), so they scope by their own date field
 * within `[periodStart, periodEnd)` — the same #59-61 all-or-none period
 * shape (default: the previous UTC calendar month). The Sales Dashboard
 * precedent already established that this codebase's dashboards read every
 * underlying table directly with per-metric filter applicability, not a
 * single uniform filter set forced onto every number.
 *
 * **"Expiring (renewal window)" reuses `RenewalCase.leadTimeDays`'s own
 * default (90 days)** as this dashboard's default window, exposed as a
 * caller-overridable `renewalWindowDays` query param — a policy nearing
 * expiry within that window is exactly what would trigger the Renewal
 * workflow's own lead time in a full implementation, so reusing the same
 * figure (rather than inventing an unrelated one) keeps the two concepts
 * aligned.
 *
 * **"New policies issued" reuses the KPI Dashboard's own "issued" test**
 * (`kpi-dashboard.md`: "`totalIssuedPremiumJod` ... null before issuance,
 * so this only ever sums real issued premium") — `issuedPremium IS NOT
 * NULL`, scoped to `Policy.createdAt` in the period, the same field Sales
 * Dashboard already scopes premium-written by.
 *
 * **"Cancelled policies and cancellation reasons" reads `Cancellation.
 * reason` via its owning `Endorsement`, scoped by `Endorsement.appliedAt`**
 * — the exact moment `EndorsementService.apply()` transitions
 * `Policy.status` to `CANCELLED` (confirmed by reading that transition
 * call directly, not assumed) — NOT `Cancellation.createdAt` (when the
 * cancellation was first REQUESTED, which can predate the period a policy
 * actually left the active book in). `reason` is free text with no fixed
 * enum, so this returns the individual cancelled-policy rows (bounded),
 * not a `groupBy` count — grouping free text would silently fragment
 * near-duplicate wording into separate buckets.
 */
export interface CancelledPolicyRow {
  policyId: string;
  policyNumber: string | null;
  /**
   * OWNER DECISION 50 — the customer's own name. A policy has NO NUMBER until issuance, so that
   * fallback branch really renders (unlike the three this product's own measurement records as
   * structurally impossible), and the dashboard rendered the internal uuid there.
   *
   * Whoever reads this dashboard is looking for the DEAL and knows its customer, not its id.
   */
  customerName: string;
  insuranceLine: string;
  reason: string;
  cancelledAt: string;
}

/**
 * THE ASYMMETRY THIS FILE'S OWN HEADER DESCRIBES, now as data a screen can read.
 *
 * Two of these four ignore the period completely: «Active policies» and «expiring
 * policies» read `Policy.status` / `Policy.expiryDate` as of `now` regardless of the
 * `period` filter, because they answer *what does the book look like right now*.
 * Printing a period beside either would be a false statement about a figure that
 * does not obey it — and owner decision 58 is about a screen making exactly that
 * kind of claim, so satisfying its letter here would have broken its purpose.
 *
 * The keys are the view's own field names, so a reader checking one against the
 * other has no mapping to do, and `satisfies` makes a fifth metric a compile error.
 */
export const POLICY_DASHBOARD_METRIC_SCOPE = {
  activePoliciesCount: 'asOf',
  expiringPoliciesCount: 'asOf',
  newPoliciesIssuedCount: 'period',
  cancelledPolicies: 'period',
} as const satisfies Record<
  | 'activePoliciesCount'
  | 'expiringPoliciesCount'
  | 'newPoliciesIssuedCount'
  | 'cancelledPolicies',
  FigureScope
>;

export interface PolicyDashboardSummary {
  generatedAt: string;
  /** Owner decision 58 — which figures the period above actually describes.
   *  A screen renders the period clause beside a `'period'` metric and an AS-OF
   *  clause beside an `'asOf'` one; it must never decide this for itself. */
  metricScope: typeof POLICY_DASHBOARD_METRIC_SCOPE;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  renewalWindowDays: number;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  newPoliciesIssuedCount: number;
  cancelledPolicies: CancelledPolicyRow[];
}

export function buildPolicyDashboardSummary(input: {
  now: Date;
  period: PeriodWindow;
  renewalWindowDays: number;
  activePoliciesCount: number;
  expiringPoliciesCount: number;
  newPoliciesIssuedCount: number;
  cancelledPolicies: CancelledPolicyRow[];
}): PolicyDashboardSummary {
  return {
    generatedAt: input.now.toISOString(),
    periodLabel: input.period.periodLabel,
    periodStart: input.period.periodStart.toISOString(),
    periodEnd: input.period.periodEnd.toISOString(),
    metricScope: POLICY_DASHBOARD_METRIC_SCOPE,
    renewalWindowDays: input.renewalWindowDays,
    activePoliciesCount: input.activePoliciesCount,
    expiringPoliciesCount: input.expiringPoliciesCount,
    newPoliciesIssuedCount: input.newPoliciesIssuedCount,
    cancelledPolicies: input.cancelledPolicies,
  };
}
