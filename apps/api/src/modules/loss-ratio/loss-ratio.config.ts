import { Prisma } from '@ibms/db';
import { formatMoney, quantizeMoney, sumMoney } from '../../common/money.util';

/** `LossRatio.ratio` is `@db.Decimal(7, 4)`. */
export const LOSS_RATIO_SCALE = 4;
/**
 * `LossRatio.ratio @db.Decimal(7, 4)` holds at most `999.9999`. A policy whose
 * accumulated claims run a four-figure multiple of its premium (a cheap
 * liability premium against a large bodily-injury settlement) would overflow
 * the column and make the upsert throw — so the ratio is clamped here and the
 * clamp is surfaced (`ratioCapped`) into the recompute result + audit row. A
 * loss ratio that far above 1 is a "renegotiate or decline renewal" signal
 * regardless of the exact figure.
 */
export const MAX_LOSS_RATIO = new Prisma.Decimal('999.9999');

export interface LossRatioInput {
  /**
   * The net settlement actually paid on each of the policy's SETTLED / CLOSED
   * claims. A `DECLINED` claim contributes nothing — there is no payout — and
   * is not passed in.
   */
  claimNetSettlements: (Prisma.Decimal | string | null)[];
  /**
   * The premium the ratio is measured against — `issuedPremium ?? requestedPremium`.
   */
  periodPremium: Prisma.Decimal | string;
}

export interface LossRatioFigures {
  periodClaims: Prisma.Decimal;
  periodPremium: Prisma.Decimal;
  ratio: Prisma.Decimal;
  /** true when the true ratio exceeded {@link MAX_LOSS_RATIO} and `ratio` was
   * clamped to fit `LossRatio.ratio @db.Decimal(7, 4)`. */
  ratioCapped: boolean;
}

/**
 * `Claims ÷ Premium` for a policy (`ibms-brain/meta/context/claims-lifecycle.md`
 * — "Loss Ratio is not a report generated after the fact; it is an input the
 * renewal workflow depends on"). `periodClaims` is the sum of net settlements
 * actually paid; `ratio` is quantized to 4 dp (`ROUND_HALF_UP`, the
 * `money-decimal-jod.md` rounding). A zero premium yields a zero ratio, never a
 * divide-by-zero; a ratio above {@link MAX_LOSS_RATIO} is clamped (with
 * `ratioCapped = true`) so it fits `LossRatio.ratio @db.Decimal(7, 4)`.
 *
 * **The "period" is a drafted `ibms-app` decision** — computed here as *every*
 * SETTLED / CLOSED claim on the policy (all-time). The renewal module (not yet
 * built) will narrow it to the policy year. Same drafted / unsourced status as
 * `CLAIM_LARGE_THRESHOLD_JOD` (#23), the #25 checklist matrix, #16's 10 % / 2 pp.
 * Pure.
 */
export function computeLossRatio(input: LossRatioInput): LossRatioFigures {
  const nets = input.claimNetSettlements.filter(
    (n): n is Prisma.Decimal | string => n != null,
  );
  // sumMoney takes the list (no spread) and returns 0 for an empty one — a
  // policy with no settled claims is a clean zero, and a book-scale list of
  // nets cannot blow the call-argument limit.
  const periodClaims = sumMoney(nets);
  const periodPremium = quantizeMoney(input.periodPremium);
  const raw = periodPremium.isZero()
    ? new Prisma.Decimal(0)
    : periodClaims
        .div(periodPremium)
        .toDecimalPlaces(LOSS_RATIO_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  const ratioCapped = raw.greaterThan(MAX_LOSS_RATIO);
  const ratio = ratioCapped ? MAX_LOSS_RATIO : raw;
  return { periodClaims, periodPremium, ratio, ratioCapped };
}

// --- Process 30: aggregate Loss Ratio breakdown -------------------------------

export const LOSS_RATIO_GROUP_BY = ['customer', 'policy', 'line'] as const;
export type LossRatioGroupBy = (typeof LOSS_RATIO_GROUP_BY)[number];

/** Minimal per-policy shape `buildLossRatioBreakdown` needs — matches
 * `AnalyticsPolicyRow` from `loss-ratio.repository.ts`. */
export interface AnalyticsPolicyLike {
  id: string;
  customerId: string;
  customerLegalName: string;
  insuranceLine: string;
  policyRef: string;
  premium: Prisma.Decimal | string;
  claimNetSettlements: (Prisma.Decimal | string | null)[];
}

export interface LossRatioBreakdownRow {
  /** the group key — a customer id, a policy id, or the line string. */
  key: string;
  /** human-readable: the customer legal name, the policy reference, or the line. */
  label: string;
  periodClaims: string;
  periodPremium: string;
  ratio: string;
  ratioCapped: boolean;
  /** SETTLED / CLOSED claims that carried a settlement in this group. */
  claimCount: number;
  policyCount: number;
}

export interface LossRatioBreakdown {
  groupBy: LossRatioGroupBy;
  /** highest ratio first, then `label` A→Z. */
  rows: LossRatioBreakdownRow[];
  totals: Omit<LossRatioBreakdownRow, 'key' | 'label'>;
}

function groupKeyLabel(
  groupBy: LossRatioGroupBy,
  p: AnalyticsPolicyLike,
): { key: string; label: string } {
  if (groupBy === 'customer') {
    return { key: p.customerId, label: p.customerLegalName };
  }
  if (groupBy === 'policy') {
    return { key: p.id, label: p.policyRef };
  }
  return { key: p.insuranceLine, label: p.insuranceLine };
}

function breakdownRowFor(
  policies: AnalyticsPolicyLike[],
): Omit<LossRatioBreakdownRow, 'key' | 'label'> {
  const nets = policies.flatMap((p) => p.claimNetSettlements);
  const figures = computeLossRatio({
    claimNetSettlements: nets,
    periodPremium: sumMoney(policies.map((p) => p.premium)),
  });
  return {
    periodClaims: formatMoney(figures.periodClaims),
    periodPremium: formatMoney(figures.periodPremium),
    ratio: figures.ratio.toFixed(LOSS_RATIO_SCALE),
    ratioCapped: figures.ratioCapped,
    claimCount: nets.filter((n) => n != null).length,
    policyCount: policies.length,
  };
}

/**
 * Process 30 — the aggregate `Claims ÷ Premium` breakdown grouped by
 * customer / policy / line, the query both the reporting dashboard and (once
 * built) the renewal workflow read. Each group's ratio is `computeLossRatio`
 * over the group's pooled net settlements and pooled written premium — so it is
 * the same **paid, all-time** basis as the per-`RenewalCase` #29 figure, not a
 * sum of per-policy ratios. Rows are ordered worst-first (highest ratio). Pure.
 */
export function buildLossRatioBreakdown(input: {
  groupBy: LossRatioGroupBy;
  policies: AnalyticsPolicyLike[];
}): LossRatioBreakdown {
  const groups = new Map<
    string,
    { label: string; policies: AnalyticsPolicyLike[] }
  >();
  for (const p of input.policies) {
    const { key, label } = groupKeyLabel(input.groupBy, p);
    const g = groups.get(key) ?? { label, policies: [] };
    g.policies.push(p);
    groups.set(key, g);
  }

  const rows: LossRatioBreakdownRow[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      ...breakdownRowFor(g.policies),
    }))
    .sort((a, b) => {
      const byRatio = new Prisma.Decimal(b.ratio).comparedTo(
        new Prisma.Decimal(a.ratio),
      );
      // fixed locale so the tie-break order is identical across environments
      return byRatio !== 0 ? byRatio : a.label.localeCompare(b.label, 'en');
    });

  return {
    groupBy: input.groupBy,
    rows,
    totals: breakdownRowFor(input.policies),
  };
}

/**
 * Audit `afterValue` for a `LossRatio` recompute — ids + the three figures as
 * fixed strings + what triggered it. No claim narrative (`sensitive-data-handling.md`).
 */
export function lossRatioAuditSnapshot(row: {
  lossRatioId: string;
  renewalCaseId: string;
  policyId: string;
  trigger: string;
  claimId: string | null;
  figures: LossRatioFigures;
}): Prisma.InputJsonObject {
  return {
    lossRatioId: row.lossRatioId,
    renewalCaseId: row.renewalCaseId,
    policyId: row.policyId,
    trigger: row.trigger,
    claimId: row.claimId,
    periodClaims: formatMoney(row.figures.periodClaims),
    periodPremium: formatMoney(row.figures.periodPremium),
    ratio: row.figures.ratio.toFixed(LOSS_RATIO_SCALE),
    ratioCapped: row.figures.ratioCapped,
  };
}
