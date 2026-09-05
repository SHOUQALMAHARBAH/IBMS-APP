import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@ibms/db';
import type { EndorsementType } from '@ibms/db';
import {
  applyPercentage,
  formatMoney,
  quantizeMoney,
  subtractMoney,
} from '../../common/money.util';

/**
 * Process 22 — Endorsement Management (backlog Part C #22, Domain B). The
 * pure, deterministic core: the signed premium adjustment, the cancellation
 * return-premium bases, the refund-approval threshold, the auto-tied
 * commission reversal, and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't
 * obvious":
 *  - "Negative endorsements (return premium) trigger the Refund Management
 *    workflow, which is maker/checker-gated by value threshold — the officer
 *    who raises the endorsement never self-approves the refund."
 *  - "Cancellation always computes a Commission Reversal tied to the same
 *    premium adjustment — the two numbers must move together."
 */

export const ENDORSEMENT_CHANGE_TYPES = [
  'add_vehicle',
  'remove_vehicle',
  'add_employee',
  'remove_employee',
  'address_change',
  'sum_insured_increase',
  'add_location',
  'change_beneficiary',
  'coverage_amendment',
] as const;
export const CANCELLATION_CHANGE_TYPE = 'cancellation';

export const CANCELLATION_BASES = ['short_period', 'pro_rata'] as const;
export type CancellationBasis = (typeof CANCELLATION_BASES)[number];

export const REFUND_REASONS = [
  'cancellation',
  'premium_reduction',
  'coverage_change',
  'overpayment',
] as const;

/**
 * The value at / above which a refund needs a distinct approver
 * (`refund.approve`) before the endorsement can be APPLIED; below it the
 * refund is auto-cleared (single-actor). **`ibms-app` product decision,
 * drafted, unsourced** — no CBJ / Part-3.5 / market figure specifies it, and
 * a real Finance approval matrix (narrative Process 37/40) belongs to a
 * Finance-config surface that does not exist yet. Filed via `/brain-gap` to
 * `ibms-brain/meta/context/policy-lifecycle.md`.
 */
export const REFUND_APPROVAL_THRESHOLD_JOD = '5000.000';

/**
 * Short-period cancellation: the client's return is LESS than pro-rata (they
 * cancelled early, the insurer retains a penalty). With no short-period scale
 * table available, `ibms-app` applies a flat **drafted, unsourced** figure —
 * on a short-period basis the client's return is
 * `SHORT_PERIOD_CLIENT_RETURN_PERCENT`% of the pro-rata figure (so 90 here =
 * a 10% early-cancellation penalty). A real short-period scale (by months
 * elapsed) should replace this. Filed via `/brain-gap` to
 * `ibms-brain/meta/context/policy-lifecycle.md`.
 */
export const SHORT_PERIOD_CLIENT_RETURN_PERCENT = '90';

function toDecimal(v: Prisma.Decimal | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/** Whole days between two instants (UTC), never negative. */
function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** The signed `Endorsement.premiumAdjustment` — a POSITIVE endorsement adds
 * premium, a NEGATIVE one returns it. `amount` is the (unsigned) figure the
 * insurer confirmed. Quantized to fils through `money.util.ts`. */
export function signedPremiumAdjustment(
  type: EndorsementType,
  amount: Prisma.Decimal | string,
): Prisma.Decimal {
  const q = quantizeMoney(amount);
  return type === 'NEGATIVE' ? subtractMoney(0, q) : q;
}

/**
 * The cancellation return premium.
 *  - `pro_rata`  — `issuedPremium × unexpiredDays / totalPolicyDays` (exact).
 *  - `short_period` — `SHORT_PERIOD_CLIENT_RETURN_PERCENT`% of the pro-rata
 *    figure (the drafted flat early-cancellation penalty above).
 * All arithmetic funnels through `money.util.ts`; the ratio is expressed as a
 * percentage so `applyPercentage` does the quantized multiply.
 */
export function cancellationReturnPremium(input: {
  issuedPremium: Prisma.Decimal | string;
  inceptionDate: Date;
  expiryDate: Date;
  cancellationDate: Date;
  basis: CancellationBasis;
}): {
  returnPremium: Prisma.Decimal;
  unexpiredDays: number;
  totalDays: number;
} {
  const totalDays = daysBetween(input.inceptionDate, input.expiryDate);
  if (totalDays <= 0) {
    throw new UnprocessableEntityException(
      'The policy period (inception → expiry) is zero or unset — a cancellation return premium cannot be computed.',
    );
  }
  const cancelFrom =
    input.cancellationDate.getTime() < input.inceptionDate.getTime()
      ? input.inceptionDate
      : input.cancellationDate;
  const unexpiredDays = Math.min(
    totalDays,
    daysBetween(cancelFrom, input.expiryDate),
  );

  const pctUnexpired = new Prisma.Decimal(unexpiredDays)
    .dividedBy(totalDays)
    .times(100);
  const proRata = applyPercentage(input.issuedPremium, pctUnexpired);

  const returnPremium =
    input.basis === 'short_period'
      ? applyPercentage(proRata, SHORT_PERIOD_CLIENT_RETURN_PERCENT)
      : proRata;

  return { returnPremium, unexpiredDays, totalDays };
}

/**
 * The commission reversal — tied 1:1 to the negative premium adjustment
 * (`policy-lifecycle.md`: "the two numbers must move together", "never
 * computed separately by hand"): `|premiumAdjustment| × commissionRatePercent`.
 * `commissionRatePercent` is the rate the policy was placed at (the
 * recommended `Quotation`'s captured rate).
 */
export function commissionReversalAmount(
  returnPremium: Prisma.Decimal | string,
  commissionRatePercent: Prisma.Decimal | string,
): Prisma.Decimal {
  return applyPercentage(
    quantizeMoney(returnPremium),
    toDecimal(commissionRatePercent),
  );
}

/** True when the refund needs the maker/checker approval step. */
export function refundNeedsApproval(amount: Prisma.Decimal | string): boolean {
  return quantizeMoney(amount).greaterThanOrEqualTo(
    REFUND_APPROVAL_THRESHOLD_JOD,
  );
}

// ---- audit snapshots (metadata + money as strings, never free text) --------

export function endorsementAuditSnapshot(row: {
  id: string;
  policyId: string;
  type: string;
  changeType: string;
  status: string;
  premiumAdjustment: Prisma.Decimal;
  requestedByUserId: string;
}): Prisma.InputJsonObject {
  return {
    endorsementId: row.id,
    policyId: row.policyId,
    type: row.type,
    changeType: row.changeType,
    status: row.status,
    premiumAdjustment: formatMoney(row.premiumAdjustment),
    requestedByUserId: row.requestedByUserId,
  };
}

export function cancellationAuditSnapshot(row: {
  endorsementId: string;
  basis: string;
  returnPremium: Prisma.Decimal;
}): Prisma.InputJsonObject {
  return {
    endorsementId: row.endorsementId,
    basis: row.basis,
    returnPremium: formatMoney(row.returnPremium),
    hasReason: true,
  };
}

export function refundAuditSnapshot(row: {
  id: string;
  endorsementId: string;
  amount: Prisma.Decimal;
  reason: string;
  raisedByUserId: string;
  approvedByUserId: string | null;
  approvalThresholdMatrixLevel: string | null;
}): Prisma.InputJsonObject {
  return {
    refundId: row.id,
    endorsementId: row.endorsementId,
    amount: formatMoney(row.amount),
    reason: row.reason,
    raisedByUserId: row.raisedByUserId,
    approvedByUserId: row.approvedByUserId,
    approvalThresholdMatrixLevel: row.approvalThresholdMatrixLevel,
  };
}

export function commissionReversalAuditSnapshot(row: {
  id: string;
  endorsementId: string;
  amount: Prisma.Decimal;
}): Prisma.InputJsonObject {
  return {
    commissionReversalId: row.id,
    endorsementId: row.endorsementId,
    amount: formatMoney(row.amount),
  };
}
