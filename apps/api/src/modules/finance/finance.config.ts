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

/** How a collection `Receipt` was received (`Receipt.method`). Also the
 * `PaymentChannel.channelType` domain (Process 38). */
export const RECEIPT_METHODS = [
  'bank_transfer',
  'cheque',
  'card',
  'cash',
] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

// --- Process 39: bank reconciliation ------------------------------------

/** The variance on one statement line: `insurerStatementAmount −
 * brokerRecordAmount`, exact to the fils (`money.util.ts`) — can be positive
 * (insurer says more than the broker recorded) or negative. NEVER rounded
 * away: a non-zero result ALWAYS raises a `ReconciliationException`
 * (`money-decimal-jod.md`). Pure. */
export function computeVariance(
  insurerStatementAmount: Prisma.Decimal | string,
  brokerRecordAmount: Prisma.Decimal | string,
): Prisma.Decimal {
  return subtractMoney(insurerStatementAmount, brokerRecordAmount);
}

/** `ReconciliationException.status` values. NOT a `WorkflowTransitionService`
 * entity — the parent `Invoice` is; this lives in a plain string like
 * `CommissionLedgerEntry.status`. */
export const RECON_EXCEPTION_STATUSES = [
  'open',
  'investigating',
  'resolved',
] as const;
export type ReconExceptionStatus = (typeof RECON_EXCEPTION_STATUSES)[number];

/** Legal `ReconciliationException.status` moves. `open` may skip straight to
 * `resolved` (an investigation step is optional); `resolved` is terminal.
 * Every move validates against this, writes an audit row, and persists via a
 * status-conditional `updateMany` (never a bare `.status =`). */
export const RECON_EXCEPTION_TRANSITIONS: Record<
  ReconExceptionStatus,
  readonly ReconExceptionStatus[]
> = {
  open: ['investigating', 'resolved'],
  investigating: ['resolved'],
  resolved: [],
};

export function isReconExceptionTransition(
  from: string,
  to: ReconExceptionStatus,
): boolean {
  const allowed = RECON_EXCEPTION_TRANSITIONS[from as ReconExceptionStatus];
  return allowed !== undefined && allowed.includes(to);
}

/** Where a resolved exception's parent `Invoice` resumes the collection cycle.
 * A subset of `WORKFLOW_TRANSITIONS.Invoice['EXCEPTION_RESOLVED']` (which also
 * allows `REMITTED`): resuming straight to `REMITTED` here would land a
 * terminal-state invoice with NO `Remittance` row and NO `out`
 * `ClientFundsLedgerEntry` — those are minted only inside
 * `POST /invoices/:id/remittance`'s `$transaction` (Part 7.3 client-money
 * trace). So `resolve` returns the invoice to `RECONCILED` and Finance
 * completes the cycle with a normal remittance call. */
export const RECON_INVOICE_RESUME_STATUSES = ['RECONCILED'] as const;
export type ReconInvoiceResumeStatus =
  (typeof RECON_INVOICE_RESUME_STATUSES)[number];

/** Sanity cap on one `POST /reconciliation-exceptions/detect` batch — a
 * statement with more lines than this is almost certainly a mistaken paste.
 * Drafted `ibms-app` product decision, same status as the other Domain D
 * caps. */
export const RECON_DETECT_MAX_LINES = 500;

export interface ReconExceptionRow {
  id: string;
  invoiceId: string | null;
  insurerStatementAmount: Prisma.Decimal;
  brokerRecordAmount: Prisma.Decimal;
  varianceAmount: Prisma.Decimal;
  status: string;
  raisedByUserId: string | null;
  investigatedByUserId: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface ReconExceptionView {
  id: string;
  invoiceId: string | null;
  insurerStatementAmount: string;
  brokerRecordAmount: string;
  varianceAmount: string;
  status: string;
  isResolved: boolean;
  raisedByUserId: string | null;
  investigatedByUserId: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export function deriveReconExceptionView(
  row: ReconExceptionRow,
): ReconExceptionView {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    insurerStatementAmount: formatMoney(row.insurerStatementAmount),
    brokerRecordAmount: formatMoney(row.brokerRecordAmount),
    varianceAmount: formatMoney(row.varianceAmount),
    status: row.status,
    isResolved: row.status === 'resolved',
    raisedByUserId: row.raisedByUserId,
    investigatedByUserId: row.investigatedByUserId,
    resolvedByUserId: row.resolvedByUserId,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** CREATE audit `afterValue` for a raised `ReconciliationException` — the
 * three figures as fixed 3dp strings + ids + status, no free text. */
export function reconExceptionAuditSnapshot(input: {
  exceptionId: string;
  invoiceId: string | null;
  insurerStatementAmount: Prisma.Decimal;
  brokerRecordAmount: Prisma.Decimal;
  varianceAmount: Prisma.Decimal;
  status: string;
}): Prisma.InputJsonObject {
  return {
    exceptionId: input.exceptionId,
    invoiceId: input.invoiceId,
    insurerStatementAmount: formatMoney(input.insurerStatementAmount),
    brokerRecordAmount: formatMoney(input.brokerRecordAmount),
    varianceAmount: formatMoney(input.varianceAmount),
    status: input.status,
  };
}

/** UPDATE audit `afterValue` for an investigate / resolve. `resolutionNote` is
 * carried **verbatim** on the resolve (the reason IS the point of the
 * "investigation and closure path" — a business justification, not personal
 * data, same rule as #35's `overrideReason`). */
export function reconExceptionUpdateAuditSnapshot(input: {
  exceptionId: string;
  invoiceId: string | null;
  varianceAmount: Prisma.Decimal;
  status: string;
  investigatedByUserId: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resumeInvoiceAs: string | null;
}): Prisma.InputJsonObject {
  return {
    exceptionId: input.exceptionId,
    invoiceId: input.invoiceId,
    varianceAmount: formatMoney(input.varianceAmount),
    status: input.status,
    investigatedByUserId: input.investigatedByUserId,
    resolvedByUserId: input.resolvedByUserId,
    resolutionNote: input.resolutionNote,
    resumeInvoiceAs: input.resumeInvoiceAs,
  };
}

// --- Process 38: approved payment channels --------------------------------

/** A `PaymentChannel` belongs to a customer (money IN, on a Receipt) or an
 * insurer (money OUT, on a Remittance). */
export const PAYMENT_CHANNEL_OWNER_TYPES = ['customer', 'insurer'] as const;
export type PaymentChannelOwnerType =
  (typeof PAYMENT_CHANNEL_OWNER_TYPES)[number];

export const PAYMENT_CHANNEL_STATUSES = ['active', 'disabled'] as const;
export type PaymentChannelStatus = (typeof PAYMENT_CHANNEL_STATUSES)[number];

/** `accountLast4` — the ONLY bank-account fragment #38 stores (masked form;
 * `sensitive-data-handling.md` — a full number is Highly Confidential). 2–4
 * digits. */
export const ACCOUNT_LAST4 = /^\d{2,4}$/;

export interface PaymentChannelRow {
  id: string;
  ownerType: string;
  customerId: string | null;
  insurerId: string | null;
  channelType: string;
  label: string;
  bankName: string | null;
  accountLast4: string | null;
  currency: string;
  status: string;
  disabledAt: Date | null;
  createdAt: Date;
}

export interface PaymentChannelView {
  id: string;
  ownerType: string;
  /** The owning customer or insurer id (exactly one of the two is set). */
  customerId: string | null;
  insurerId: string | null;
  channelType: string;
  label: string;
  bankName: string | null;
  /** Masked account fragment — never a full number. */
  accountLast4: string | null;
  currency: string;
  status: string;
  isActive: boolean;
  disabledAt: string | null;
  createdAt: string;
}

export function derivePaymentChannelView(
  row: PaymentChannelRow,
): PaymentChannelView {
  return {
    id: row.id,
    ownerType: row.ownerType,
    customerId: row.customerId,
    insurerId: row.insurerId,
    channelType: row.channelType,
    label: row.label,
    bankName: row.bankName,
    accountLast4: row.accountLast4,
    currency: row.currency,
    status: row.status,
    isActive: row.status === 'active',
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Process 38 — CREATE / UPDATE audit `afterValue` for a `PaymentChannel`.
 * Carries ids + `ownerType` + `channelType` + `label` + `bankName` + `status`.
 * **Never `accountLast4`** — even the masked fragment stays out of the audit
 * trail (it adds nothing and keeps the row free of any bank-account data). */
export function paymentChannelAuditSnapshot(input: {
  channelId: string;
  ownerType: string;
  customerId: string | null;
  insurerId: string | null;
  channelType: string;
  label: string;
  bankName: string | null;
  status: string;
}): Prisma.InputJsonObject {
  return {
    channelId: input.channelId,
    ownerType: input.ownerType,
    customerId: input.customerId,
    insurerId: input.insurerId,
    channelType: input.channelType,
    label: input.label,
    bankName: input.bankName,
    status: input.status,
  };
}

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
  /** Process 38 — the approved customer payment channel used (or null). */
  paymentChannelId: string | null;
  receivedAt: string;
}

export interface InvoiceRemittanceView {
  id: string;
  amount: string;
  insurerId: string;
  /** Process 38 — the approved insurer payment channel used (or null). */
  paymentChannelId: string | null;
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
  paymentChannelId: string | null;
  receivedAt: Date;
  remittance: {
    id: string;
    amount: Prisma.Decimal;
    insurerId: string;
    paymentChannelId: string | null;
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
          paymentChannelId: receipt.paymentChannelId,
          receivedAt: receipt.receivedAt.toISOString(),
        }
      : null,
    remittance: receipt?.remittance
      ? {
          id: receipt.remittance.id,
          amount: formatMoney(receipt.remittance.amount),
          insurerId: receipt.remittance.insurerId,
          paymentChannelId: receipt.remittance.paymentChannelId,
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
  paymentChannelId: string | null;
  receivedAt: Date;
}): Prisma.InputJsonObject {
  return {
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    customerId: input.customerId,
    amount: formatMoney(input.amount),
    method: input.method,
    paymentChannelId: input.paymentChannelId,
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
  paymentChannelId: string | null;
  remittedAt: Date | null;
}): Prisma.InputJsonObject {
  return {
    remittanceId: input.remittanceId,
    receiptId: input.receiptId,
    invoiceId: input.invoiceId,
    insurerId: input.insurerId,
    amount: formatMoney(input.amount),
    paymentChannelId: input.paymentChannelId,
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

// --- Process 34: insurer accounts-payable / remittance obligations ---------

/**
 * Process 34 — Insurer Accounting. The pure core of the accounts-payable /
 * remittance-obligations report: what the broker owes each insurer.
 *
 * The obligation arises the moment the client's premium is collected (#32's
 * `Receipt`) and is discharged by the `Remittance` (#32's
 * `RECONCILED → REMITTED` hop). So an **outstanding** obligation is a
 * collected-but-not-yet-remitted invoice — the broker is holding the client's
 * money that belongs to the insurer (Part 7.3). The amount owed per invoice is
 * `premiumAmount − commissionDeducted` — exactly #32's `computeRemittanceAmount`
 * / the eventual `Remittance.amount` (tax + fees stay with the broker). The
 * **remitted** side is straight from the `Remittance` rows. All money through
 * `money.util.ts`.
 *
 * `ibms-brain/meta/context/finance-lifecycle.md` § "Insurer Accounting
 * (Process 34)".
 */

/** Cap on how many collected-but-unremitted invoices / `Remittance` rows one
 * payables report materialises + groups in memory. A broker's open remittance
 * pipeline fits comfortably; `InsurerAccountingService` `logger.warn`s on
 * truncation (the #30 `ANALYTICS_POLICY_LIMIT` / #33 `AR_AGEING_INVOICE_LIMIT`
 * precedent). */
export const INSURER_PAYABLES_ROW_LIMIT = 5000;

/** One collected-but-unremitted invoice — the net premium the broker is
 * holding for an insurer, and when the client paid (the AP clock start).
 * Matches `InvoiceRepository.loadInsurerObligations`'s row. */
export interface InsurerObligationRow {
  invoiceId: string;
  insurerId: string;
  insurerName: string;
  /** carried from the policy's premium / commission — the net owed is derived
   * here (`premiumAmount − commissionDeducted`), never re-typed. */
  premiumAmount: Prisma.Decimal | string;
  commissionDeducted: Prisma.Decimal | string;
  /** `Receipt.receivedAt` — when the broker received the client's money and the
   * obligation to the insurer arose. */
  collectedAt: Date;
}

/** One `Remittance` already paid to an insurer (as at the report's `asOf`).
 * Matches `InvoiceRepository.loadInsurerRemittances`'s row. */
export interface InsurerRemittanceRow {
  remittanceId: string;
  insurerId: string;
  insurerName: string;
  amount: Prisma.Decimal | string;
  remittedAt: Date;
}

export interface InsurerPayableRow {
  insurerId: string;
  insurerName: string;
  /** Σ (`premiumAmount − commissionDeducted`) over this insurer's
   * collected-but-unremitted invoices — what the broker currently owes it. */
  outstandingAmount: string;
  outstandingCount: number;
  /** Earliest client-payment date among the unremitted obligations (ISO), or
   * null when the insurer has none outstanding (remitted-only row). */
  oldestCollectedAt: string | null;
  /** Whole days since `oldestCollectedAt` — the worst-first sort key
   * (`>= 0`; `-1` when nothing is outstanding). */
  oldestDaysOutstanding: number;
  /** Σ `Remittance.amount` already paid to this insurer as at `asOf`. */
  remittedAmount: string;
  remittedCount: number;
}

export interface InsurerPayablesTotals {
  outstandingAmount: string;
  outstandingCount: number;
  remittedAmount: string;
  remittedCount: number;
  insurerCount: number;
}

export interface InsurerPayablesReport {
  /** The reference date, UTC midnight, ISO (default: today). */
  asOf: string;
  /** SINGLE-CURRENCY: `'JOD'`. `Remittance` has no currency column and every
   * `Invoice.currency` is JOD (`money.util.ts` is fils-precision JOD); same
   * assumption as #33's `buildReceivablesAgeing` and #30's
   * `buildLossRatioBreakdown`. */
  currency: string;
  /** One row per insurer with an outstanding and/or remitted balance,
   * worst-first (largest days-outstanding, then largest amount owed). */
  rows: InsurerPayableRow[];
  totals: InsurerPayablesTotals;
}

interface InsurerPayableAcc {
  insurerName: string;
  outstanding: Prisma.Decimal[];
  outstandingCount: number;
  oldestCollectedMs: number | null;
  oldestDaysOutstanding: number;
  remitted: Prisma.Decimal[];
  remittedCount: number;
}

/**
 * Process 34 — the accounts-payable / remittance-obligations report, grouped by
 * insurer. `outstandingAmount` pools each collected-but-unremitted invoice's
 * `premiumAmount − commissionDeducted` (`computeRemittanceAmount`);
 * `remittedAmount` pools the `Remittance.amount`s already paid. Both through
 * `sumMoney` — never an averaged or re-derived figure. Rows worst-first:
 * largest days-outstanding, then largest amount owed, then insurer name (fixed
 * `en` locale). Pure.
 */
export function buildInsurerPayables(input: {
  asOf: Date;
  obligations: InsurerObligationRow[];
  remittances: InsurerRemittanceRow[];
}): InsurerPayablesReport {
  const byInsurer = new Map<string, InsurerPayableAcc>();

  const accFor = (id: string, name: string): InsurerPayableAcc => {
    let acc = byInsurer.get(id);
    if (!acc) {
      acc = {
        insurerName: name,
        outstanding: [],
        outstandingCount: 0,
        oldestCollectedMs: null,
        oldestDaysOutstanding: -1,
        remitted: [],
        remittedCount: 0,
      };
      byInsurer.set(id, acc);
    }
    return acc;
  };

  for (const o of input.obligations) {
    const acc = accFor(o.insurerId, o.insurerName);
    acc.outstanding.push(
      computeRemittanceAmount(o.premiumAmount, o.commissionDeducted),
    );
    acc.outstandingCount += 1;
    const days = daysOverdue(o.collectedAt, input.asOf);
    acc.oldestCollectedMs =
      acc.oldestCollectedMs === null
        ? o.collectedAt.getTime()
        : Math.min(acc.oldestCollectedMs, o.collectedAt.getTime());
    acc.oldestDaysOutstanding = Math.max(acc.oldestDaysOutstanding, days);
  }

  for (const r of input.remittances) {
    const acc = accFor(r.insurerId, r.insurerName);
    acc.remitted.push(quantizeMoney(r.amount));
    acc.remittedCount += 1;
  }

  const rows: InsurerPayableRow[] = [...byInsurer.entries()]
    .map(([insurerId, acc]) => ({
      insurerId,
      insurerName: acc.insurerName,
      outstandingAmount: formatMoney(sumMoney(acc.outstanding)),
      outstandingCount: acc.outstandingCount,
      oldestCollectedAt:
        acc.oldestCollectedMs === null
          ? null
          : new Date(acc.oldestCollectedMs).toISOString(),
      oldestDaysOutstanding: acc.oldestDaysOutstanding,
      remittedAmount: formatMoney(sumMoney(acc.remitted)),
      remittedCount: acc.remittedCount,
    }))
    .sort(
      (a, b) =>
        b.oldestDaysOutstanding - a.oldestDaysOutstanding ||
        compareMoney(b.outstandingAmount, a.outstandingAmount) ||
        a.insurerName.localeCompare(b.insurerName, 'en'),
    );

  const allOutstanding = input.obligations.map((o) =>
    computeRemittanceAmount(o.premiumAmount, o.commissionDeducted),
  );
  const allRemitted = input.remittances.map((r) => quantizeMoney(r.amount));

  return {
    asOf: new Date(utcMidnightMs(input.asOf)).toISOString(),
    currency: 'JOD',
    rows,
    totals: {
      outstandingAmount: formatMoney(sumMoney(allOutstanding)),
      outstandingCount: allOutstanding.length,
      remittedAmount: formatMoney(sumMoney(allRemitted)),
      remittedCount: allRemitted.length,
      insurerCount: byInsurer.size,
    },
  };
}
