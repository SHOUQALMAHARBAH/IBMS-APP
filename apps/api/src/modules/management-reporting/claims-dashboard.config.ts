import type { Prisma } from '@ibms/db';
import { formatMoney, sumMoney } from '../../common/money.util';
import {
  buildLossRatioBreakdown,
  type AnalyticsPolicyLike,
  type LossRatioBreakdownRow,
} from '../loss-ratio/loss-ratio.config';

/**
 * Part E — Claims Dashboard (backlog Process #64, Part 13). Bullet text:
 * "open vs. closed claims, outstanding claims value, claims ageing, loss
 * ratio by client/line/insurer." `dashboard.claims.view` was already
 * pre-seeded (`[CLAIMS_OFFICER, BRANCH_DEPARTMENT_MANAGER, EXECUTIVE_
 * MANAGEMENT]`) — its first real consumer, no earlier backlog item had
 * touched this permission (unlike `dashboard.sales.view`).
 *
 * **Every one of this bullet's four metrics is phrased as a CURRENT-STATE
 * noun, not a period-scoped event** — unlike Sales/Policy Dashboards, there
 * is no "claims opened this period" or "claims closed this period" wording
 * anywhere. So this dashboard carries NO `periodStart`/`periodEnd` range —
 * every metric is a live snapshot. Part E's own cross-cutting rule still
 * demands "filterable by... time period," so a single `asOf` REFERENCE-DATE
 * override is exposed instead of a range (the `client-accounting.md` #33 AR
 * ageing report's own shape) — the honest interpretation of "time period"
 * for a dashboard whose every metric is a point-in-time snapshot rather
 * than a range-scoped count.
 *
 * `asOf` narrows which claims are considered (`createdAt <= asOf`, the AR
 * ageing precedent) but classifies each by its CURRENT `Claim.status`, not
 * the status it held as of that date — full historical reconstruction would
 * need to walk `ClaimStatusHistory`, which this dashboard doesn't attempt.
 * Documented limitation, not an oversight (the AR ageing report's own "a
 * receipt means paid in full" simplification is the same shape).
 *
 * **"Open vs. closed"**: `CLOSED` is the ONLY terminal `ClaimStatus`
 * (`WORKFLOW_TRANSITIONS.Claim` — reachable only via `DECLINED -> CLOSED` or
 * `SETTLED -> CLOSED`), so "open" is simply "status != CLOSED."
 *
 * **"Outstanding claims value"** sums, over every OPEN claim, the more
 * precise figure once known: `Settlement.netSettlement` when a settlement
 * already exists (a claim can be `SETTLED` but not yet `CLOSED`), else
 * `Claim.estimatedLoss` — the same "netSettlement is the ground truth once
 * available" precedent `computeLossRatio` itself uses for `periodClaims`.
 *
 * **"Claims ageing"** buckets each open claim by whole days between
 * `Claim.createdAt` (the NOTIFIED moment) and `asOf` — measuring how long a
 * claim has sat unresolved, not time-to-loss. Unlike the AR ageing bands
 * (which include a `current`/"not yet due" bucket), an open claim starts
 * ageing from day zero, so the buckets begin at `d0_30` — the same 30/60/90
 * boundary spirit as `AR_AGEING_BUCKET_KEYS`, adapted since there is no
 * "not yet due" state for an already-open claim.
 *
 * **"Loss ratio by client/line/insurer"** reuses the pre-existing, all-time
 * `buildLossRatioBreakdown` pure function from Process 30 (widened here to
 * add an `insurer` grouping) — called three times over the SAME fetched
 * policy set, the #62 Portfolio Analysis "several breakdowns in one
 * response" shape. Reused via a direct import of a PURE function, one step
 * lighter than #63 Profitability Analysis's own repository-injection
 * precedent (no DI wiring at all) — `computeLossRatio`'s own documented
 * "all-time" scope is untouched, so `asOf` does not affect it.
 */

export const CLAIMS_DASHBOARD_OPEN_CLAIM_LIMIT = 5000;

export const CLAIMS_AGEING_BUCKET_KEYS = [
  'd0_30',
  'd31_60',
  'd61_90',
  'd90_plus',
] as const;
export type ClaimsAgeingBucketKey = (typeof CLAIMS_AGEING_BUCKET_KEYS)[number];

const AGEING_DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnightMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days a claim has been open as of the reference date. */
export function daysOpen(createdAt: Date, asOf: Date): number {
  return Math.max(
    0,
    Math.floor(
      (utcMidnightMs(asOf) - utcMidnightMs(createdAt)) / AGEING_DAY_MS,
    ),
  );
}

/** `0-30` / `31-60` / `61-90` / `90+` days open — no "not yet due" bucket,
 * since an open claim is aging from the moment it is notified. */
export function ageingBucketFor(days: number): ClaimsAgeingBucketKey {
  if (days <= 30) return 'd0_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface OpenClaimRow {
  id: string;
  createdAt: Date;
  estimatedLoss: Prisma.Decimal | string;
  netSettlement: Prisma.Decimal | string | null;
}

export interface ClaimsAgeingBucketRow {
  count: number;
  valueJod: string;
}
export type ClaimsAgeingBuckets = Record<
  ClaimsAgeingBucketKey,
  ClaimsAgeingBucketRow
>;

export interface OpenClaimsBreakdown {
  openClaimsCount: number;
  outstandingClaimsValueJod: string;
  ageing: ClaimsAgeingBuckets;
}

function zeroBuckets(): Record<
  ClaimsAgeingBucketKey,
  { count: number; values: (Prisma.Decimal | string)[] }
> {
  return {
    d0_30: { count: 0, values: [] },
    d31_60: { count: 0, values: [] },
    d61_90: { count: 0, values: [] },
    d90_plus: { count: 0, values: [] },
  };
}

/**
 * Pure: the open-claims side of the dashboard — outstanding value +
 * ageing buckets, in one pass over the (already-filtered) open claim rows.
 */
export function buildOpenClaimsBreakdown(input: {
  asOf: Date;
  openClaims: OpenClaimRow[];
}): OpenClaimsBreakdown {
  const buckets = zeroBuckets();
  const allValues: (Prisma.Decimal | string)[] = [];

  for (const claim of input.openClaims) {
    const value = claim.netSettlement ?? claim.estimatedLoss;
    allValues.push(value);
    const bucket = ageingBucketFor(daysOpen(claim.createdAt, input.asOf));
    buckets[bucket].count += 1;
    buckets[bucket].values.push(value);
  }

  const ageing = CLAIMS_AGEING_BUCKET_KEYS.reduce((acc, key) => {
    acc[key] = {
      count: buckets[key].count,
      valueJod: formatMoney(sumMoney(buckets[key].values)),
    };
    return acc;
  }, {} as ClaimsAgeingBuckets);

  return {
    openClaimsCount: input.openClaims.length,
    outstandingClaimsValueJod: formatMoney(sumMoney(allValues)),
    ageing,
  };
}

export interface ClaimsDashboardSummary {
  generatedAt: string;
  asOf: string;
  openClaimsCount: number;
  closedClaimsCount: number;
  outstandingClaimsValueJod: string;
  ageing: ClaimsAgeingBuckets;
  lossRatioByClient: LossRatioBreakdownRow[];
  lossRatioByLine: LossRatioBreakdownRow[];
  lossRatioByInsurer: LossRatioBreakdownRow[];
}

export function buildClaimsDashboardSummary(input: {
  now: Date;
  asOf: Date;
  closedClaimsCount: number;
  openClaims: OpenClaimRow[];
  lossRatioPolicies: AnalyticsPolicyLike[];
}): ClaimsDashboardSummary {
  const openBreakdown = buildOpenClaimsBreakdown({
    asOf: input.asOf,
    openClaims: input.openClaims,
  });

  return {
    generatedAt: input.now.toISOString(),
    asOf: input.asOf.toISOString(),
    openClaimsCount: openBreakdown.openClaimsCount,
    closedClaimsCount: input.closedClaimsCount,
    outstandingClaimsValueJod: openBreakdown.outstandingClaimsValueJod,
    ageing: openBreakdown.ageing,
    lossRatioByClient: buildLossRatioBreakdown({
      groupBy: 'customer',
      policies: input.lossRatioPolicies,
    }).rows,
    lossRatioByLine: buildLossRatioBreakdown({
      groupBy: 'line',
      policies: input.lossRatioPolicies,
    }).rows,
    lossRatioByInsurer: buildLossRatioBreakdown({
      groupBy: 'insurer',
      policies: input.lossRatioPolicies,
    }).rows,
  };
}
