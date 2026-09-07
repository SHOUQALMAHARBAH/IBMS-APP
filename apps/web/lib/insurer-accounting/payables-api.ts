// Process 34 — Insurer Accounting (backlog Part C #34, Domain D). Reads apps/api's
// GET /insurer-accounting/payables: the accounts-payable / remittance-obligations
// report per insurer (net premium collected but not yet remitted, plus remitted
// to date), computed on the fly from Invoice / Receipt / Remittance.
// `insurer-accounting.read`.

import { apiGet } from '../auth/api-client';

export interface InsurerPayableRow {
  insurerId: string;
  insurerName: string;
  outstandingAmount: string;
  outstandingCount: number;
  oldestCollectedAt: string | null;
  oldestDaysOutstanding: number;
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
  asOf: string;
  currency: string;
  rows: InsurerPayableRow[];
  totals: InsurerPayablesTotals;
}

export function getInsurerPayables(
  opts: { insurerId?: string; asOf?: string } = {},
): Promise<InsurerPayablesReport> {
  const params = new URLSearchParams();
  if (opts.insurerId) params.set('insurerId', opts.insurerId);
  if (opts.asOf) params.set('asOf', opts.asOf);
  const qs = params.toString();
  return apiGet(`/insurer-accounting/payables${qs ? `?${qs}` : ''}`);
}
