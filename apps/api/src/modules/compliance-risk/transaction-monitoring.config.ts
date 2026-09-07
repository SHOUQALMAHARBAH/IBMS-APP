import type { Prisma } from '@ibms/db';
import { compareMoney, formatMoney } from '../../common/money.util';

/**
 * Process 48 — AML/CFT Transaction Monitoring (backlog Part C #48, Domain F
 * — opens Compliance & Risk beyond KYC). The pure, deterministic core: the
 * `patternType`/`status` domains, the drafted detection thresholds, the
 * per-pattern classifiers, and the view / audit-snapshot shapes.
 *
 * `TransactionMonitoringAlert` (Part 7.2 core schema) pre-existed; this
 * module is its first real consumer. `aml.monitor` / `aml.escalate`
 * (`[COMPLIANCE_OFFICER]`) were both seeded ahead of time — no seed change.
 *
 * `ibms-brain/meta/context/transaction-monitoring.md`.
 */

export const TRANSACTION_MONITORING_PATTERN_TYPES = [
  'large_premium_payment',
  'frequent_cancellations',
  'frequent_refunds',
  'third_party_payment_source',
  'other',
] as const;
export type TransactionMonitoringPatternType =
  (typeof TRANSACTION_MONITORING_PATTERN_TYPES)[number];

export function isTransactionMonitoringPatternType(
  v: string,
): v is TransactionMonitoringPatternType {
  return (TRANSACTION_MONITORING_PATTERN_TYPES as readonly string[]).includes(
    v,
  );
}

/** The two automated, event-scoped patterns — each traces back to exactly
 * one triggering `Receipt` via `sourceEntityType`/`sourceEntityId`. */
export const RECEIPT_SCOPED_PATTERN_TYPES = [
  'large_premium_payment',
  'third_party_payment_source',
] as const;

export const TRANSACTION_MONITORING_STATUSES = ['open', 'closed'] as const;
export type TransactionMonitoringAlertStatus =
  (typeof TRANSACTION_MONITORING_STATUSES)[number];

export function isTerminalTransactionMonitoringStatus(status: string): boolean {
  return status === 'closed';
}

/** Cap on a book-wide `TransactionMonitoringAlert` list. */
export const TRANSACTION_MONITORING_READ_LIMIT = 5000;

/**
 * "Unusually large premium payment" threshold. **DRAFTED / UNSOURCED** — Part
 * 7.2 names the pattern, not a figure; same drafted-constant status as
 * `CLAIM_LARGE_THRESHOLD_JOD` (#23) and the #41/#42/#46 SLA figures. Compared
 * against the underlying `Invoice.premiumAmount` of a `Receipt` that actually
 * collected payment — a raised-but-unpaid Invoice is not yet a "payment".
 */
export const AML_LARGE_PREMIUM_THRESHOLD_JOD = '15000.000';

/** True when `premiumAmount` is at / above {@link AML_LARGE_PREMIUM_THRESHOLD_JOD}. */
export function isLargePremiumPayment(
  premiumAmount: Prisma.Decimal | string,
): boolean {
  return compareMoney(premiumAmount, AML_LARGE_PREMIUM_THRESHOLD_JOD) >= 0;
}

/**
 * A `Receipt`'s `PaymentChannel` belongs to a customer other than the one
 * being invoiced — the invoiced customer's premium was paid from someone
 * else's account. Deterministic, no threshold.
 *
 * **DORMANT in production, not merely gapped** — a `@code-reviewer` BLOCKER
 * on the first pass. `CollectionService.assertReceiptChannelUsable` (#38,
 * `apps/api/src/modules/finance/collection.service.ts`) already rejects any
 * NEW `Receipt` whose channel does not belong to the invoiced customer,
 * *before* a `Receipt` row can ever exist with that mismatch — and
 * `PaymentChannel` has no reassign-owner path (`customerId`/`ownerType` are
 * fixed at creation). So this function can never return `true` against a
 * `Receipt` created through the real `POST /invoices/:id/receipt` endpoint;
 * `transaction-monitoring.e2e-spec.ts` only exercises it by inserting a
 * `Receipt` directly via Prisma, deliberately bypassing `CollectionService`,
 * to prove the classifier logic itself is correct — not because the
 * scenario is reachable in normal operation.
 *
 * Kept coded, unit-tested, and wired into the sweep as a forward-compatible
 * detector: it activates automatically, with no further code change, the
 * day a legitimate cross-customer payment path is added (e.g. a documented
 * family/corporate-group payment arrangement) or a third-party payer
 * identity is recorded outside the approved-channel system entirely. A
 * `Receipt` with no recorded `PaymentChannel` at all (optional — #38) is a
 * separate, narrower gap: it cannot be classified either way by this
 * function and is silently skipped.
 */
export function isThirdPartyPaymentSource(input: {
  invoiceCustomerId: string;
  paymentChannel: { ownerType: string; customerId: string | null } | null;
}): boolean {
  if (!input.paymentChannel) return false;
  return (
    input.paymentChannel.ownerType === 'customer' &&
    input.paymentChannel.customerId !== null &&
    input.paymentChannel.customerId !== input.invoiceCustomerId
  );
}

/**
 * "Frequent cancellations/refunds" lookback + threshold. **DRAFTED /
 * UNSOURCED** — same status as the premium threshold above. A rolling
 * calendar-day window (not business days — this is a payment-behaviour
 * pattern, not a chase-the-counterparty deadline like `follow-up.util.ts`'s
 * `isFollowUpDue`).
 */
export const AML_FREQUENT_CANCELLATION_LOOKBACK_DAYS = 90;
export const AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT = 3;
export const AML_FREQUENT_REFUND_LOOKBACK_DAYS = 90;
export const AML_FREQUENT_REFUND_THRESHOLD_COUNT = 3;

/** True when `count` clears `threshold` — the same test for both aggregate
 * patterns, parameterised so each keeps its own drafted threshold. */
export function isFrequentPattern(count: number, threshold: number): boolean {
  return count >= threshold;
}

/** One `Cancellation`/`Refund` row, reduced to what the aggregate classifier
 * needs: which customer, and when. */
export interface DatedCustomerEvent {
  customerId: string;
  createdAt: Date;
}

/** Counts `rows` on/after `windowStart`, grouped by `customerId`. Pure — the
 * sweep loads the rows, this just tallies them. */
export function countRecentByCustomer(
  rows: readonly DatedCustomerEvent[],
  windowStart: Date,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.createdAt.getTime() < windowStart.getTime()) continue;
    counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1);
  }
  return counts;
}

export interface ReceiptForSweep {
  id: string;
  invoice: { id: string; customerId: string; premiumAmount: Prisma.Decimal };
  paymentChannel: { ownerType: string; customerId: string | null } | null;
}

export interface DetectedAlertCandidate {
  patternType: TransactionMonitoringPatternType;
  customerId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  detailText: string;
}

/** Every automated candidate a single `Receipt` produces (0, 1, or both —
 * large-premium and third-party-source are independent checks on the same
 * row). Pure. */
export function detectReceiptPatterns(
  receipt: ReceiptForSweep,
): DetectedAlertCandidate[] {
  const candidates: DetectedAlertCandidate[] = [];

  if (isLargePremiumPayment(receipt.invoice.premiumAmount)) {
    candidates.push({
      patternType: 'large_premium_payment',
      customerId: receipt.invoice.customerId,
      sourceEntityType: 'Receipt',
      sourceEntityId: receipt.id,
      detailText:
        `Premium payment of ${formatMoney(receipt.invoice.premiumAmount)} JOD ` +
        `on invoice ${receipt.invoice.id} meets or exceeds the ` +
        `${AML_LARGE_PREMIUM_THRESHOLD_JOD} JOD monitoring threshold (drafted).`,
    });
  }

  if (
    isThirdPartyPaymentSource({
      invoiceCustomerId: receipt.invoice.customerId,
      paymentChannel: receipt.paymentChannel,
    })
  ) {
    candidates.push({
      patternType: 'third_party_payment_source',
      customerId: receipt.invoice.customerId,
      sourceEntityType: 'Receipt',
      sourceEntityId: receipt.id,
      detailText:
        `Receipt ${receipt.id} on invoice ${receipt.invoice.id} was paid via a ` +
        `payment channel owned by a different customer.`,
    });
  }

  return candidates;
}

export function buildFrequentCancellationDetail(
  count: number,
  lookbackDays: number,
): string {
  return (
    `${count} cancellation(s) in the trailing ${lookbackDays} calendar days ` +
    `(threshold ${AML_FREQUENT_CANCELLATION_THRESHOLD_COUNT}, drafted).`
  );
}

export function buildFrequentRefundDetail(
  count: number,
  lookbackDays: number,
): string {
  return (
    `${count} refund(s) in the trailing ${lookbackDays} calendar days ` +
    `(threshold ${AML_FREQUENT_REFUND_THRESHOLD_COUNT}, drafted).`
  );
}

export interface TransactionMonitoringAlertRow {
  id: string;
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  detectedAt: Date;
  escalatedToSuspiciousActivity: boolean;
  escalatedAt: Date | null;
  reportedToAuthorityAt: Date | null;
  status: string;
  classification: string;
}

export interface TransactionMonitoringAlertView {
  id: string;
  customerId: string | null;
  patternType: string;
  detailText: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  detectedAt: string;
  escalatedToSuspiciousActivity: boolean;
  escalatedAt: string | null;
  reportedToAuthorityAt: string | null;
  status: string;
  isClosed: boolean;
  classification: string;
}

export function deriveTransactionMonitoringAlertView(
  row: TransactionMonitoringAlertRow,
): TransactionMonitoringAlertView {
  return {
    id: row.id,
    customerId: row.customerId,
    patternType: row.patternType,
    detailText: row.detailText,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    detectedAt: row.detectedAt.toISOString(),
    escalatedToSuspiciousActivity: row.escalatedToSuspiciousActivity,
    escalatedAt: row.escalatedAt ? row.escalatedAt.toISOString() : null,
    reportedToAuthorityAt: row.reportedToAuthorityAt
      ? row.reportedToAuthorityAt.toISOString()
      : null,
    status: row.status,
    isClosed: isTerminalTransactionMonitoringStatus(row.status),
    classification: row.classification,
  };
}

/** CREATE/UPDATE audit `afterValue` — ids + `patternType` + `status` +
 * source provenance only. `detailText` is deliberately EXCLUDED — Part
 * 7.2/`sensitive-data-handling.md`: it can name a payment counterparty or
 * describe a specific fund movement, and the model's own default
 * classification is HIGHLY_CONFIDENTIAL (the #44 `subject`/`body`, #45
 * `comments` precedent). */
export function transactionMonitoringAlertAuditSnapshot(input: {
  alertId: string;
  customerId: string | null;
  patternType: string;
  status: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  escalatedToSuspiciousActivity?: boolean;
  reportedToAuthorityAt?: Date | null;
}): Prisma.InputJsonObject {
  return {
    alertId: input.alertId,
    customerId: input.customerId,
    patternType: input.patternType,
    status: input.status,
    sourceEntityType: input.sourceEntityType ?? null,
    sourceEntityId: input.sourceEntityId ?? null,
    ...(input.escalatedToSuspiciousActivity !== undefined
      ? { escalatedToSuspiciousActivity: input.escalatedToSuspiciousActivity }
      : {}),
    ...(input.reportedToAuthorityAt !== undefined
      ? {
          reportedToAuthorityAt: input.reportedToAuthorityAt
            ? input.reportedToAuthorityAt.toISOString()
            : null,
        }
      : {}),
  };
}
