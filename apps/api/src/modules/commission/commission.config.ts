import { Prisma } from '@ibms/db';
import {
  applyPercentage,
  compareMoney,
  formatMoney,
} from '../../common/money.util';

/**
 * Process 35 — Commission Calculation (backlog Part C #35, Domain D). The
 * pure, deterministic core: resolving the governed commission rate for an
 * (insurer, line) at a point in time from the `CommissionAgreement` table,
 * computing the commission amount, the `CommissionAgreement` /
 * `CommissionLedgerEntry` views, and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/finance-lifecycle.md` § "Commission Calculation
 * (Process 35)".
 */

/** Upper sanity bound on a governed / override commission rate — a rate above
 * 100 % would make the commission exceed the premium. `CommissionAgreement
 * .ratePercent` is `@db.Decimal(5, 2)` (column max 999.99); this is the
 * business bound. Matches `quotation.config.ts`'s `MAX_COMMISSION_RATE_PERCENT`
 * (imported there for the #31 billing backstop). */
export const COMMISSION_MAX_RATE_PERCENT = 100;

/** The `CommissionLedgerEntry.status` values (Process 36 owns the lifecycle;
 * #35 only ever creates at `outstanding`). */
export const COMMISSION_ENTRY_STATUSES = [
  'outstanding',
  'paid',
  'reversed',
] as const;
export type CommissionEntryStatus = (typeof COMMISSION_ENTRY_STATUSES)[number];

// --- governed rate resolution ---------------------------------------------

/** The minimal `CommissionAgreement` shape `resolveGovernedRate` needs. */
export interface CommissionAgreementLike {
  id: string;
  ratePercent: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * The one governed `CommissionAgreement` in force for a point in time `at`:
 * the row whose window `[effectiveFrom, effectiveTo)` contains `at` (an open
 * `effectiveTo IS NULL` window has no upper bound). The partial UNIQUE index
 * (`CommissionAgreement_one_open_per_insurer_line`) guarantees at most one
 * *open* window per (insurer, line); historical closed windows are contiguous
 * (each supersede stamps the prior `effectiveTo = new.effectiveFrom`), so at
 * most one row matches. Returns `null` when the pair has no agreement covering
 * `at` (the caller 422s). Pure.
 */
export function resolveGovernedRate(
  agreements: readonly CommissionAgreementLike[],
  at: Date,
): CommissionAgreementLike | null {
  const t = at.getTime();
  const matches = agreements.filter(
    (a) =>
      a.effectiveFrom.getTime() <= t &&
      (a.effectiveTo === null || t < a.effectiveTo.getTime()),
  );
  if (matches.length === 0) return null;
  // Deterministic if the (impossible-by-the-index) case of two matches ever
  // arises: the latest-starting window wins.
  return matches.reduce((latest, a) =>
    a.effectiveFrom.getTime() > latest.effectiveFrom.getTime() ? a : latest,
  );
}

/**
 * The commission earned on a premium at a governed rate:
 * `premium × ratePercent%`, quantized to fils (`money.util.ts`). Since the
 * caller bounds `ratePercent` to `0..COMMISSION_MAX_RATE_PERCENT`, the result
 * is `>= 0` and `<= premium`. Pure.
 */
export function computeCommissionAmount(
  premium: Prisma.Decimal | string,
  ratePercent: Prisma.Decimal | string,
): Prisma.Decimal {
  return applyPercentage(premium, ratePercent);
}

// --- views --------------------------------------------------------------------

export interface CommissionAgreementRow {
  id: string;
  insurerId: string;
  insurerName: string;
  insuranceLine: string;
  ratePercent: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface CommissionAgreementView {
  id: string;
  insurerId: string;
  insurerName: string;
  insuranceLine: string;
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** `effectiveTo IS NULL` — the current governed rate for the pair. */
  isOpen: boolean;
}

export function deriveAgreementView(
  row: CommissionAgreementRow,
): CommissionAgreementView {
  return {
    id: row.id,
    insurerId: row.insurerId,
    insurerName: row.insurerName,
    insuranceLine: row.insuranceLine,
    ratePercent: row.ratePercent.toFixed(2),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    isOpen: row.effectiveTo === null,
  };
}

export interface CommissionLedgerEntryRow {
  id: string;
  policyId: string;
  commissionAgreementId: string | null;
  amount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  overrideAmount: Prisma.Decimal | null;
  status: string;
  isManualOverride: boolean;
  overrideReason: string | null;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  createdAt: Date;
}

export interface CommissionLedgerEntryView {
  id: string;
  policyId: string;
  commissionAgreementId: string | null;
  /** The governed figure (`premium × governed rate%`). */
  amount: string;
  vatAmount: string;
  /** The proposed manual-override amount, or null. */
  overrideAmount: string | null;
  /** The amount that actually counts: `overrideAmount` once the override is
   * approved, else `amount`. */
  effectiveAmount: string;
  status: string;
  isManualOverride: boolean;
  overrideReason: string | null;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  /** An override has been raised but not yet approved — `amount` still governs. */
  overridePending: boolean;
  createdAt: string;
}

export function deriveLedgerEntryView(
  row: CommissionLedgerEntryRow,
): CommissionLedgerEntryView {
  const overridePending =
    row.isManualOverride && row.overrideApprovedByUserId === null;
  return {
    id: row.id,
    policyId: row.policyId,
    commissionAgreementId: row.commissionAgreementId,
    amount: formatMoney(row.amount),
    vatAmount: formatMoney(row.vatAmount),
    overrideAmount:
      row.overrideAmount !== null ? formatMoney(row.overrideAmount) : null,
    // `amount` IS the effective figure at every stage: the governed rate on a
    // fresh / pending-override entry (a pending override never touches it), and
    // the override once `approveOverride` copies `overrideAmount` in. Reading
    // it here (not `overrideAmount`) means a divergence would surface, never
    // hide.
    effectiveAmount: formatMoney(row.amount),
    status: row.status,
    isManualOverride: row.isManualOverride,
    overrideReason: row.overrideReason,
    overrideRequestedByUserId: row.overrideRequestedByUserId,
    overrideApprovedByUserId: row.overrideApprovedByUserId,
    overridePending,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True when a raised-but-not-yet-approved override carries byte-identical
 * figures — the write-once "resume vs. 409" test on the raise path. */
export function overrideProposalMatches(
  row: { overrideAmount: Prisma.Decimal | null; overrideReason: string | null },
  proposal: { overrideAmount: Prisma.Decimal; reason: string },
): boolean {
  return (
    row.overrideAmount !== null &&
    compareMoney(row.overrideAmount, proposal.overrideAmount) === 0 &&
    row.overrideReason === proposal.reason
  );
}

// --- audit snapshots (ids + figures as fixed strings, minimal free text) -----

export function agreementAuditSnapshot(input: {
  agreementId: string;
  insurerId: string;
  insuranceLine: string;
  ratePercent: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  supersededAgreementId: string | null;
}): Prisma.InputJsonObject {
  return {
    agreementId: input.agreementId,
    insurerId: input.insurerId,
    insuranceLine: input.insuranceLine,
    ratePercent: input.ratePercent.toFixed(2),
    effectiveFrom: input.effectiveFrom.toISOString(),
    effectiveTo: input.effectiveTo ? input.effectiveTo.toISOString() : null,
    supersededAgreementId: input.supersededAgreementId,
  };
}

export function commissionEntryAuditSnapshot(input: {
  entryId: string;
  policyId: string;
  commissionAgreementId: string | null;
  ratePercentApplied: string;
  amount: Prisma.Decimal;
  status: string;
}): Prisma.InputJsonObject {
  return {
    entryId: input.entryId,
    policyId: input.policyId,
    commissionAgreementId: input.commissionAgreementId,
    ratePercentApplied: input.ratePercentApplied,
    amount: formatMoney(input.amount),
    status: input.status,
  };
}

/**
 * Audit `afterValue` for a manual-override raise / approve. Carries the
 * proposed / effective amount, the maker + checker ids, and the mandatory
 * `overrideReason` verbatim — the reason IS the point of the "separately
 * logged" requirement (Part 5.2), and it is a business justification, not
 * personal data. Same shape as #22's `refundAuditSnapshot`.
 */
export function overrideAuditSnapshot(input: {
  entryId: string;
  policyId: string;
  overrideAmount: Prisma.Decimal;
  overrideReason: string;
  overrideRequestedByUserId: string | null;
  overrideApprovedByUserId: string | null;
  amountAfter: Prisma.Decimal;
}): Prisma.InputJsonObject {
  return {
    entryId: input.entryId,
    policyId: input.policyId,
    overrideAmount: formatMoney(input.overrideAmount),
    overrideReason: input.overrideReason,
    overrideRequestedByUserId: input.overrideRequestedByUserId,
    overrideApprovedByUserId: input.overrideApprovedByUserId,
    amountAfter: formatMoney(input.amountAfter),
  };
}
