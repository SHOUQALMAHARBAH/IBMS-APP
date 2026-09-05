// Process 31–32 — Premium Billing + Collection (backlog Part C #31–32, Domain
// D — Finance). Talks to apps/api's finance module (invoice.controller.ts):
// raises the new-business premium Invoice against an issued policy (#31), then
// drives it through the collection cycle — receipt (INVOICED → COLLECTED),
// reconcile (COLLECTED → RECONCILED), remittance (RECONCILED → REMITTED) — #32.

import { apiGet, apiPost } from '../auth/api-client';

export type InvoiceStatus =
  | 'INVOICED'
  | 'COLLECTED'
  | 'RECONCILED'
  | 'REMITTED'
  | 'EXCEPTION_RAISED'
  | 'EXCEPTION_RESOLVED';

export const RECEIPT_METHOD_OPTIONS = [
  'bank_transfer',
  'cheque',
  'card',
  'cash',
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
  receipt: InvoiceReceipt | null;
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
  return apiPost('/invoices', input);
}

/** Process 32 — record the client's collection receipt for the full invoiced
 * total. Drives `INVOICED → COLLECTED`. */
export function recordReceipt(
  invoiceId: string,
  input: { amount: string; method?: string },
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
