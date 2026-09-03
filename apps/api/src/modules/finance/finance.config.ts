import { Prisma } from '@ibms/db';
import type { InvoiceStatus } from '@ibms/db';
import {
  addMoney,
  applyPercentage,
  compareMoney,
  formatMoney,
  quantizeMoney,
  subtractMoney,
  sumMoney,
} from '../../common/money.util';

/**
 * Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
 * D). The pure, deterministic core: composing an `Invoice`'s five figures from
 * the policy's issued premium + the placed commission rate + the Finance-
 * supplied tax and fees (#31), the net-premium remittance figure (#32), the
 * `Invoice` cycle view, and the audit `afterValue` snapshots.
 *
 * `ibms-brain/meta/context/finance-lifecycle.md` § "Premium Billing (Process
 * 31)":
 *  - premium is CARRIED from `Policy.issuedPremium` (never an input);
 *  - commission is auto-derived — `premium x commissionRatePercent`, the rate
 *    the policy was placed at (`Recommendation.recommendedQuotation
 *    .commissionRatePercent`); a policy whose quotation captured no rate
 *    cannot be billed net of commission (422);
 *  - tax and fees are the only Finance inputs;
 *  - `totalAmount` is ALWAYS `premium + tax + fees - commissionDeducted`,
 *    computed here — the DTO does not accept it.
 */

/** The `Invoice.invoiceType` for the one new-business premium invoice #31
 * raises per policy (the value the partial UNIQUE index keys on). Later
 * endorsement / renewal premium invoices carry a different type and are not
 * constrained. */
export const NEW_BUSINESS_PREMIUM_INVOICE_TYPE = 'new_business_premium';

/** Upper sanity bound on how far ahead a `dueDate` may be set — a year. A
 * due date past this (or in the past) is a data-entry error, not a payment
 * term. `ibms-app` product decision; no CBJ / Part-3.6 figure specifies a
 * maximum credit period. */
export const INVOICE_MAX_DUE_DAYS_AHEAD = 365;

/** How a collection `Receipt` was received (`Receipt.method`). */
export const RECEIPT_METHODS = [
  'bank_transfer',
  'cheque',
  'card',
  'cash',
] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

/**
 * Process 32 — the net premium the broker owes the insurer for a fully-
 * collected invoice: the issued premium less the broker's commission. #31
 * bounds `commissionDeducted <= premiumAmount`, so this is `>= 0`. Tax and
 * fees stay with the broker (passed to the tax authority / retained as fee
 * income — out of scope for #32). All through `money.util.ts`.
 */
export function computeRemittanceAmount(
  premiumAmount: Prisma.Decimal | string,
  commissionDeducted: Prisma.Decimal | string,
): Prisma.Decimal {
  return subtractMoney(premiumAmount, commissionDeducted);
}

export interface InvoiceFigureInputs {
  /** Carried from `Policy.issuedPremium`. */
  premiumAmount: Prisma.Decimal | string;
  /** `Recommendation.recommendedQuotation.commissionRatePercent` — the rate
   * (e.g. `12.5` for 12.5%), not a fraction. */
  commissionRatePercent: Prisma.Decimal | string;
  /** Finance input — the applicable premium tax. `>= 0`. */
  taxAmount: Prisma.Decimal | string;
  /** Finance input — broker / issuance fees. `>= 0`. */
  feesAmount: Prisma.Decimal | string;
}

export interface InvoiceFigures {
  premiumAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  feesAmount: Prisma.Decimal;
  commissionDeducted: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

/**
 * Composes the five stored figures. `commissionDeducted` is quantized
 * (`premium x rate%`) and `totalAmount` is derived from the ALREADY-quantized
 * components (`premium + tax + fees - commissionDeducted`), so
 * `premium + tax + fees - commissionDeducted === totalAmount` holds exactly on
 * the persisted 3dp values — the figures cannot silently disagree.
 *
 * This function is PURE and does not validate: `totalAmount` can come out
 * negative if `commissionRatePercent > 100` (commission exceeds premium). The
 * `InvoiceService.create` new-invoice path bounds the rate to `0..100`
 * (`MAX_COMMISSION_RATE_PERCENT`) and re-asserts `totalAmount >= 0` before the
 * write — that is what guarantees a non-negative client bill, not this helper.
 */
export function computeInvoiceFigures(
  input: InvoiceFigureInputs,
): InvoiceFigures {
  const premiumAmount = quantizeMoney(input.premiumAmount);
  const taxAmount = quantizeMoney(input.taxAmount);
  const feesAmount = quantizeMoney(input.feesAmount);
  const commissionDeducted = applyPercentage(
    premiumAmount,
    input.commissionRatePercent,
  );
  const totalAmount = subtractMoney(
    addMoney(premiumAmount, taxAmount, feesAmount),
    commissionDeducted,
  );
  return {
    premiumAmount,
    taxAmount,
    feesAmount,
    commissionDeducted,
    totalAmount,
  };
}

/** True when both invoices carry byte-identical money figures + due date —
 * the write-once "resume vs. 409" test (mirrors #28 `recordSettlement`). */
export function invoiceFiguresMatch(
  a: {
    premiumAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    feesAmount: Prisma.Decimal;
    commissionDeducted: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    dueDate: Date;
  },
  b: InvoiceFigures & { dueDate: Date },
): boolean {
  return (
    compareMoney(a.premiumAmount, b.premiumAmount) === 0 &&
    compareMoney(a.taxAmount, b.taxAmount) === 0 &&
    compareMoney(a.feesAmount, b.feesAmount) === 0 &&
    compareMoney(a.commissionDeducted, b.commissionDeducted) === 0 &&
    compareMoney(a.totalAmount, b.totalAmount) === 0 &&
    a.dueDate.getTime() === b.dueDate.getTime()
  );
}

// --- view --------------------------------------------------------------------

export interface InvoiceReceiptView {
  id: string;
  amount: string;
  method: string | null;
  receivedAt: string;
}

export interface InvoiceRemittanceView {
  id: string;
  amount: string;
  insurerId: string;
  remittedAt: string | null;
}

export interface InvoiceView {
  id: string;
  policyId: string | null;
  customerId: string;
  invoiceType: string;
  premiumAmount: string;
  taxAmount: string;
  feesAmount: string;
  commissionDeducted: string;
  totalAmount: string;
  currency: string;
  dueDate: string;
  status: InvoiceStatus;
  createdAt: string;
  /** Process 32 — `premiumAmount − commissionDeducted`, the net premium the
   * broker owes the insurer. Computed here so the UI never does money math. */
  netRemittance: string;
  /** Process 32 — the client's collection receipt (or null). #32 records at
   * most one, for the full invoiced total. */
  receipt: InvoiceReceiptView | null;
  /** Process 32 — the net-premium remittance to the insurer (or null). */
  remittance: InvoiceRemittanceView | null;
}

export interface InvoiceReceiptRow {
  id: string;
  amount: Prisma.Decimal;
  method: string | null;
  receivedAt: Date;
  remittance: {
    id: string;
    amount: Prisma.Decimal;
    insurerId: string;
    remittedAt: Date | null;
  } | null;
}

export interface InvoiceRow {
  id: string;
  policyId: string | null;
  customerId: string;
  invoiceType: string;
  premiumAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  feesAmount: Prisma.Decimal;
  commissionDeducted: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: string;
  dueDate: Date;
  status: InvoiceStatus;
  createdAt: Date;
  /** Present on a with-cycle read (#32); absent on a bare `Invoice` fetch. */
  receipts?: InvoiceReceiptRow[];
}

export function deriveInvoiceView(row: InvoiceRow): InvoiceView {
  const receipt =
    row.receipts && row.receipts.length > 0 ? row.receipts[0] : null;
  return {
    id: row.id,
    policyId: row.policyId,
    customerId: row.customerId,
    invoiceType: row.invoiceType,
    premiumAmount: formatMoney(row.premiumAmount),
    taxAmount: formatMoney(row.taxAmount),
    feesAmount: formatMoney(row.feesAmount),
    commissionDeducted: formatMoney(row.commissionDeducted),
    totalAmount: formatMoney(row.totalAmount),
    currency: row.currency,
    dueDate: row.dueDate.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    netRemittance: formatMoney(
      computeRemittanceAmount(row.premiumAmount, row.commissionDeducted),
    ),
    receipt: receipt
      ? {
          id: receipt.id,
          amount: formatMoney(receipt.amount),
          method: receipt.method,
          receivedAt: receipt.receivedAt.toISOString(),
        }
      : null,
    remittance: receipt?.remittance
      ? {
          id: receipt.remittance.id,
          amount: formatMoney(receipt.remittance.amount),
          insurerId: receipt.remittance.insurerId,
          remittedAt: receipt.remittance.remittedAt?.toISOString() ?? null,
        }
      : null,
  };
}

// --- audit snapshot (metadata + money as fixed strings, no free text) -------

/**
 * CREATE audit `afterValue` for a raised invoice. Money as fixed 3dp strings
 * + ids + the commission rate applied + the due date — no free text (an
 * invoice carries none). Same shape as #28 `settlementAuditSnapshot`.
 */
export function invoiceAuditSnapshot(input: {
  invoiceId: string;
  policyId: string | null;
  customerId: string;
  invoiceType: string;
  premiumAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  feesAmount: Prisma.Decimal;
  commissionDeducted: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  commissionRatePercent: string;
  currency: string;
  dueDate: Date;
  status: InvoiceStatus;
}): Prisma.InputJsonObject {
  return {
    invoiceId: input.invoiceId,
    policyId: input.policyId,
    customerId: input.customerId,
    invoiceType: input.invoiceType,
    premiumAmount: formatMoney(input.premiumAmount),
    taxAmount: formatMoney(input.taxAmount),
    feesAmount: formatMoney(input.feesAmount),
    commissionDeducted: formatMoney(input.commissionDeducted),
    totalAmount: formatMoney(input.totalAmount),
    commissionRatePercent: input.commissionRatePercent,
    currency: input.currency,
    dueDate: input.dueDate.toISOString(),
    status: input.status,
  };
}

/** Process 32 — CREATE audit `afterValue` for a collection `Receipt`. Money
 * as a fixed 3dp string + ids + method; no free text (a receipt carries
 * none). */
export function receiptAuditSnapshot(input: {
  receiptId: string;
  invoiceId: string;
  customerId: string;
  amount: Prisma.Decimal;
  method: string | null;
  receivedAt: Date;
}): Prisma.InputJsonObject {
  return {
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    customerId: input.customerId,
    amount: formatMoney(input.amount),
    method: input.method,
    receivedAt: input.receivedAt.toISOString(),
  };
}

/** Process 32 — CREATE audit `afterValue` for a `Remittance` to an insurer. */
export function remittanceAuditSnapshot(input: {
  remittanceId: string;
  receiptId: string;
  invoiceId: string;
  insurerId: string;
  amount: Prisma.Decimal;
  remittedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    remittanceId: input.remittanceId,
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    insurerId: input.insurerId,
    amount: formatMoney(input.amount),
    remittedAt: input.remittedAt?.toISOString() ?? null,
  };
}

/**
 * Process 32 / Part 7.3 — CREATE audit `afterValue` for a
 * `ClientFundsLedgerEntry`. Client funds must be identifiable and reconcilable
 * separately from the broker's own operating funds at all times; every
 * collection books an `in` entry and every remittance an `out` entry against
 * this ledger. `reference` is a `receipt:` / `remittance:` id pointer, never
 * free text.
 */
export function clientFundsLedgerAuditSnapshot(input: {
  entryId: string;
  customerId: string;
  amount: Prisma.Decimal;
  direction: string;
  reference: string | null;
}): Prisma.InputJsonObject {
  return {
    entryId: input.entryId,
    customerId: input.customerId,
    amount: formatMoney(input.amount),
    direction: input.direction,
    reference: input.reference,
  };
}

// --- Process 33: accounts-receivable ageing ---------------------------------

/**
 * Process 33 — Client Accounting. The pure core of the accounts-receivable /
 * ageing report: from a set of outstanding `Invoice` rows (an invoice with no
 * collection `Receipt` — #32 records exactly one, for the full total, so a
 * receipt means paid in full), group by customer and split each customer's
 * outstanding balance into 30 / 60 / 90-day ageing buckets keyed off
 * `Invoice.dueDate` vs the report's `asOf` reference date. Ordered worst-first
 * (oldest debt, then largest balance). All money through `money.util.ts`.
 *
 * `ibms-brain/meta/context/finance-lifecycle.md` § "Client Accounting (Process
 * 33)".
 */

/** Standard 30 / 60 / 90-day accounts-receivable ageing buckets. **Drafted /
 * unsourced** `ibms-app` product decision — Part 3.6 says only "an
 * accounts-receivable / ageing report per customer" and names no boundaries;
 * these are the textbook AR ageing bands. Same drafted status as
 * `INVOICE_MAX_DUE_DAYS_AHEAD` (#31), `CLAIM_LARGE_THRESHOLD_JOD` (#23), the
 * #27 follow-up thresholds and the #29 loss-ratio "period". */
export const AR_AGEING_BUCKET_KEYS = [
  'current',
  'd1_30',
  'd31_60',
  'd61_90',
  'd90_plus',
] as const;
export type ArAgeingBucketKey = (typeof AR_AGEING_BUCKET_KEYS)[number];

/**
 * Cap on the number of outstanding invoices one ageing report materialises +
 * groups in memory. A broker's open-AR book fits comfortably; if a query ever
 * hits this the report is silently truncated, so `ClientAccountingService`
 * `logger.warn`s (the #30 `ANALYTICS_POLICY_LIMIT` precedent) — the signal to
 * push the aggregation into the DB.
 */
export const AR_AGEING_INVOICE_LIMIT = 5000;

const AGEING_DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnightMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole calendar days a due date is past the ageing reference date — negative
 * when the invoice is not yet due. Both instants are normalised to their own
 * UTC midnight first (`Invoice.dueDate` is already UTC midnight — #31
 * `parseDueDateInstant`), so the result is a clean day count regardless of the
 * wall-clock time `asOf` carries.
 */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  return Math.floor(
    (utcMidnightMs(asOf) - utcMidnightMs(dueDate)) / AGEING_DAY_MS,
  );
}

/** Which ageing bucket a days-overdue count falls in: `<= 0` (not yet due, or
 * due exactly on the reference date) is `current`; then 1–30 / 31–60 / 61–90 /
 * over 90. */
export function ageingBucketFor(days: number): ArAgeingBucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

/** The minimal per-invoice shape `buildReceivablesAgeing` needs — matches
 * `InvoiceRepository.loadOutstandingReceivables`'s row. */
export interface OutstandingInvoiceRow {
  id: string;
  customerId: string;
  customerLegalName: string;
  totalAmount: Prisma.Decimal | string;
  currency: string;
  dueDate: Date;
}

export type ArAgeingBucketAmounts = Record<ArAgeingBucketKey, string>;

export interface CustomerReceivablesRow extends ArAgeingBucketAmounts {
  customerId: string;
  customerLegalName: string;
  currency: string;
  /** Sum of the five buckets — this customer's total outstanding balance. */
  outstandingTotal: string;
  invoiceCount: number;
  /** Earliest `dueDate` among this customer's outstanding invoices (ISO), or
   * null if it somehow has none. */
  oldestDueDate: string | null;
  /** Largest days-overdue among this customer's outstanding invoices — the
   * worst-first sort key. Negative when every invoice is still `current`. */
  oldestDaysOverdue: number;
}

export interface ReceivablesAgeingTotals extends ArAgeingBucketAmounts {
  outstandingTotal: string;
  invoiceCount: number;
  customerCount: number;
}

export interface ReceivablesAgeingReport {
  /** The ageing reference date, UTC midnight, ISO — the `asOf` the buckets are
   * measured against (default: today). */
  asOf: string;
  currency: string;
  /** One row per customer with an outstanding balance, worst-first. */
  rows: CustomerReceivablesRow[];
  /** Every outstanding invoice pooled, regardless of customer. */
  totals: ReceivablesAgeingTotals;
}

function zeroBuckets(): Record<ArAgeingBucketKey, Prisma.Decimal> {
  return {
    current: new Prisma.Decimal(0),
    d1_30: new Prisma.Decimal(0),
    d31_60: new Prisma.Decimal(0),
    d61_90: new Prisma.Decimal(0),
    d90_plus: new Prisma.Decimal(0),
  };
}

function bucketsToStrings(
  b: Record<ArAgeingBucketKey, Prisma.Decimal>,
): ArAgeingBucketAmounts {
  return {
    current: formatMoney(b.current),
    d1_30: formatMoney(b.d1_30),
    d31_60: formatMoney(b.d31_60),
    d61_90: formatMoney(b.d61_90),
    d90_plus: formatMoney(b.d90_plus),
  };
}

interface CustomerAgeingAcc {
  customerLegalName: string;
  currency: string;
  buckets: Record<ArAgeingBucketKey, Prisma.Decimal>;
  amounts: Prisma.Decimal[];
  invoiceCount: number;
  oldestDueMs: number | null;
  oldestDaysOverdue: number;
}

/**
 * Process 33 — the accounts-receivable / ageing report, grouped by customer.
 * Each outstanding invoice's `totalAmount` lands in one ageing bucket
 * (`daysOverdue(dueDate, asOf)` → `ageingBucketFor`); the per-customer
 * `outstandingTotal` and the book-wide `totals` are pooled through
 * `sumMoney` (never an averaged or re-derived figure). Rows are ordered
 * worst-first: largest days-overdue, then largest outstanding balance, then
 * customer name (fixed `en` locale, deterministic across environments). Pure.
 *
 * SINGLE-CURRENCY: bucket + `outstandingTotal` figures are pooled per customer
 * with no currency split, and `report.currency` is `'JOD'`. Every `Invoice`
 * carries a `currency` (kept on the row for display), but it is always `'JOD'`
 * today — `money.util.ts` is fils-precision JOD, and no non-JOD policy /
 * invoice path exists. If a foreign-currency invoice ever lands, a customer
 * with mixed-currency invoices would get a silently-wrong pooled total; the
 * fix then is to group by `(customerId, currency)`. Same assumption as #30's
 * `buildLossRatioBreakdown` (`money-decimal-jod.md` — JOD).
 */
export function buildReceivablesAgeing(input: {
  asOf: Date;
  invoices: OutstandingInvoiceRow[];
}): ReceivablesAgeingReport {
  const byCustomer = new Map<string, CustomerAgeingAcc>();
  const grandBuckets = zeroBuckets();
  const grandAmounts: Prisma.Decimal[] = [];

  for (const inv of input.invoices) {
    const days = daysOverdue(inv.dueDate, input.asOf);
    const key = ageingBucketFor(days);
    const amount = quantizeMoney(inv.totalAmount);

    let acc = byCustomer.get(inv.customerId);
    if (!acc) {
      acc = {
        customerLegalName: inv.customerLegalName,
        currency: inv.currency,
        buckets: zeroBuckets(),
        amounts: [],
        invoiceCount: 0,
        oldestDueMs: null,
        oldestDaysOverdue: days,
      };
      byCustomer.set(inv.customerId, acc);
    }
    acc.buckets[key] = acc.buckets[key].plus(amount);
    acc.amounts.push(amount);
    acc.invoiceCount += 1;
    acc.oldestDueMs =
      acc.oldestDueMs === null
        ? inv.dueDate.getTime()
        : Math.min(acc.oldestDueMs, inv.dueDate.getTime());
    acc.oldestDaysOverdue = Math.max(acc.oldestDaysOverdue, days);

    grandBuckets[key] = grandBuckets[key].plus(amount);
    grandAmounts.push(amount);
  }

  const rows: CustomerReceivablesRow[] = [...byCustomer.entries()]
    .map(([customerId, acc]) => ({
      customerId,
      customerLegalName: acc.customerLegalName,
      currency: acc.currency,
      ...bucketsToStrings(acc.buckets),
      outstandingTotal: formatMoney(sumMoney(acc.amounts)),
      invoiceCount: acc.invoiceCount,
      oldestDueDate:
        acc.oldestDueMs === null
          ? null
          : new Date(acc.oldestDueMs).toISOString(),
      oldestDaysOverdue: acc.oldestDaysOverdue,
    }))
    .sort(
      (a, b) =>
        b.oldestDaysOverdue - a.oldestDaysOverdue ||
        compareMoney(b.outstandingTotal, a.outstandingTotal) ||
        a.customerLegalName.localeCompare(b.customerLegalName, 'en'),
    );

  return {
    asOf: new Date(utcMidnightMs(input.asOf)).toISOString(),
    currency: 'JOD',
    rows,
    totals: {
      ...bucketsToStrings(grandBuckets),
      outstandingTotal: formatMoney(sumMoney(grandAmounts)),
      invoiceCount: grandAmounts.length,
      customerCount: byCustomer.size,
    },
  };
}
