// Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
// D — Finance). Talks to apps/api's finance module (invoice.controller.ts):
// raises the new-business premium Invoice against an issued policy (#31), then
// drives it through the collection cycle — receipt (INVOICED → COLLECTED),
// reconcile (COLLECTED → RECONCILED), remittance (RECONCILED → REMITTED) — #32.

import { apiFetchBlob, apiGet, apiPost } from "../auth/api-client";

export type InvoiceStatus =
  | "INVOICED"
  | "COLLECTED"
  | "RECONCILED"
  | "REMITTED"
  | "EXCEPTION_RAISED"
  | "EXCEPTION_RESOLVED";

export const RECEIPT_METHOD_OPTIONS = [
  "bank_transfer",
  "cheque",
  "card",
  "cash",
] as const;
export type ReceiptMethod = (typeof RECEIPT_METHOD_OPTIONS)[number];

export interface InvoiceReceipt {
  id: string;
  amount: string;
  method: string | null;
  receivedAt: string;
}

export interface InvoiceRemittance {
  id: string;
  amount: string;
  insurerId: string;
  remittedAt: string | null;
}

export interface Invoice {
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
  /** premium − commission — the net owed to the insurer, computed server-side. */
  netRemittance: string;
  /** Process 32 — every instalment recorded against this invoice, oldest
   * first. An invoice may be settled in parts. */
  receipts: InvoiceReceipt[];
  /** The most recent instalment (or null). */
  receipt: InvoiceReceipt | null;
  /** Σ of every instalment so far, computed server-side. */
  collectedAmount: string;
  /** `totalAmount − collectedAmount`; `0.000` once settled. */
  outstandingAmount: string;
  fullyCollected: boolean;
  remittance: InvoiceRemittance | null;
}

export interface CreateInvoiceInput {
  policyId: string;
  /** The applicable premium tax. */
  taxAmount: string;
  /** Broker / issuance fees. Optional, defaults to 0. */
  feesAmount?: string;
  /** When payment is due — a calendar date, YYYY-MM-DD. */
  dueDate: string;
}

export function listInvoicesForPolicy(policyId: string): Promise<Invoice[]> {
  return apiGet(`/invoices?policyId=${encodeURIComponent(policyId)}`);
}

export function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  return apiPost("/invoices", input);
}

/** Process 32 — record one collection instalment. `amount` may be less than
 * the invoiced total; the invoice walks `INVOICED → COLLECTED` only on the
 * instalment that completes it. `reference` (the client's payment/bank/voucher
 * reference) is MANDATORY — it is the idempotency key, and without it a
 * retried submit is indistinguishable from a genuine second instalment of the
 * same amount, so the client's money gets booked twice
 * instead of booking a second instalment. */
export function recordReceipt(
  invoiceId: string,
  input: { amount: string; method?: string; reference: string },
): Promise<Invoice> {
  return apiPost(`/invoices/${invoiceId}/receipt`, input);
}

/** Process 32 — confirm the collected funds reconcile to the invoiced total.
 * Drives `COLLECTED → RECONCILED`. */
export function reconcileInvoice(invoiceId: string): Promise<Invoice> {
  return apiPost(`/invoices/${invoiceId}/reconcile`);
}

/** Process 32 — remit the net premium to the insurer. Drives
 * `RECONCILED → REMITTED`. */
export function recordRemittance(invoiceId: string): Promise<Invoice> {
  return apiPost(`/invoices/${invoiceId}/remittance`, {});
}

// Part F item #7 — bilingual invoice PDF, generated on demand. Omitting
// `language` defaults to the customer's own `languagePreference` — mirrored
// here by only showing the download button once an invoice exists (see
// FinanceSection.tsx).
export function downloadInvoiceDocument(
  id: string,
  language?: "AR" | "EN" | "DUAL",
): Promise<Blob> {
  const qs = language ? `?language=${language}` : "";
  return apiFetchBlob(`/invoices/${encodeURIComponent(id)}/document${qs}`);
}
