import { Prisma } from '@ibms/db';
import type { InvoiceStatus } from '@ibms/db';
import {
  addMoney,
  applyPercentage,
  compareMoney,
  formatMoney,
  quantizeMoney,
  subtractMoney,
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
