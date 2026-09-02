// Process 31 — Premium Billing (backlog Part C #31, Domain D — Finance).
// Talks to apps/api's finance module (invoice.controller.ts): raises the
// new-business premium Invoice against an issued policy (premium carried from
// the policy, commission auto-derived from the placed quotation rate, tax +
// fees supplied here, total computed server-side) and reads invoices back
// scoped to a policy.

import { apiGet, apiPost } from '../auth/api-client';

export type InvoiceStatus =
  | 'INVOICED'
  | 'COLLECTED'
  | 'RECONCILED'
  | 'REMITTED'
  | 'EXCEPTION_RAISED'
  | 'EXCEPTION_RESOLVED';

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
