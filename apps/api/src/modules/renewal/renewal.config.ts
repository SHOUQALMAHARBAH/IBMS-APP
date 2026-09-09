import type { RenewalStatus } from '@ibms/db';
import type { RenewalCaseWithContext } from '../../repositories/renewal-case.repository';
import { formatMoney } from '../../common/money.util';

/**
 * Part 3.9 — the renewal lead time. The context document's own figure, and
 * the same 90 calendar days the `renewal_workflow_start` SLA registry entry
 * and `RenewalCase.leadTimeDays`'s schema default already carry. Unlike most
 * numbers in this codebase this one IS sourced (Part 3.9 / the A.8 SLA
 * table), so it is not a drafted-and-unsourced constant.
 */
export const DEFAULT_RENEWAL_LEAD_TIME_DAYS = 90;

/** Statuses at which a renewal case is still live work. Anything else is
 * concluded, and `RetentionCaseService.runSweep` reads them accordingly. */
export const OPEN_RENEWAL_STATUSES: readonly RenewalStatus[] = [
  'RENEWAL_DUE',
  'IN_PROGRESS',
  'QUOTES_OBTAINED',
  'RECOMMENDED',
  'CLIENT_DECISION',
];

export function isOpenRenewalStatus(status: RenewalStatus): boolean {
  return OPEN_RENEWAL_STATUSES.includes(status);
}

export interface RenewalCaseView {
  id: string;
  policyId: string;
  customerId: string;
  customerLegalName: string;
  policyNumber: string | null;
  insuranceLine: string;
  insurerId: string;
  policyStatus: string;
  inceptionDate: string | null;
  expiryDate: string | null;
  status: RenewalStatus;
  leadTimeDays: number;
  triggeredAt: string;
  riskChangedSinceLastRenewal: boolean;
  insurerTermsWorsened: boolean;
  retentionEscalatedAt: string | null;
  /** True while the case is still live work — drives the UI's open/closed
   * split and mirrors what the retention sweep keys off. */
  open: boolean;
  /** Part 3.9 — a renewal with a materially changed risk needs a fresh Risk
   * Assessment, and worsened insurer terms need full re-marketing. Surfaced
   * as one derived flag so a screen does not have to re-implement the rule. */
  requiresRemarketing: boolean;
  /** Process 29/30 — the per-case Loss Ratio, computed when the case opens
   * and recomputed whenever a claim on the policy closes. Null until the
   * first recompute lands. */
  lossRatio: {
    periodClaims: string;
    periodPremium: string;
    ratio: string;
  } | null;
}

export function deriveRenewalCaseView(
  row: RenewalCaseWithContext,
): RenewalCaseView {
  return {
    id: row.id,
    policyId: row.policyId,
    customerId: row.policy.customerId,
    customerLegalName: row.policy.customer.legalName,
    policyNumber: row.policy.policyNumber,
    insuranceLine: row.policy.insuranceLine,
    insurerId: row.policy.insurerId,
    policyStatus: row.policy.status,
    inceptionDate: row.policy.inceptionDate?.toISOString() ?? null,
    expiryDate: row.policy.expiryDate?.toISOString() ?? null,
    status: row.status,
    leadTimeDays: row.leadTimeDays,
    triggeredAt: row.triggeredAt.toISOString(),
    riskChangedSinceLastRenewal: row.riskChangedSinceLastRenewal,
    insurerTermsWorsened: row.insurerTermsWorsened,
    retentionEscalatedAt: row.retentionEscalatedAt?.toISOString() ?? null,
    open: isOpenRenewalStatus(row.status),
    requiresRemarketing:
      row.riskChangedSinceLastRenewal || row.insurerTermsWorsened,
    lossRatio: row.lossRatio
      ? {
          periodClaims: formatMoney(row.lossRatio.periodClaims),
          periodPremium: formatMoney(row.lossRatio.periodPremium),
          // 4dp, matching the Decimal(7,4) column and `computeLossRatio`.
          ratio: row.lossRatio.ratio.toFixed(4),
        }
      : null,
  };
}

/** The renewal SLA is due `leadTimeDays` BEFORE expiry — the point the
 * workflow must have started by, not a deadline counted forward from now.
 * Returns null for a policy with no expiry date (nothing to renew against). */
export function renewalDueAt(
  expiryDate: Date | null,
  leadTimeDays: number,
): Date | null {
  if (!expiryDate) return null;
  const due = new Date(expiryDate.getTime());
  due.setUTCDate(due.getUTCDate() - leadTimeDays);
  return due;
}

/** CREATE/UPDATE audit `afterValue` — ids, the window and the flags. No
 * customer name, no premium (the #23/#31 metadata-not-body convention). */
export function renewalCaseAuditSnapshot(row: {
  id: string;
  policyId: string;
  status: RenewalStatus;
  leadTimeDays: number;
  riskChangedSinceLastRenewal: boolean;
  insurerTermsWorsened: boolean;
}): Record<string, string | number | boolean> {
  return {
    renewalCaseId: row.id,
    policyId: row.policyId,
    status: row.status,
    leadTimeDays: row.leadTimeDays,
    riskChangedSinceLastRenewal: row.riskChangedSinceLastRenewal,
    insurerTermsWorsened: row.insurerTermsWorsened,
  };
}
