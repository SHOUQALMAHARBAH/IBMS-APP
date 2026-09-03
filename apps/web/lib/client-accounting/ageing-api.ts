// Process 33 — Client Accounting (backlog Part C #33, Domain D). Reads apps/api's
// GET /client-accounting/ageing: the accounts-receivable / ageing report per
// customer (outstanding invoices split into 30 / 60 / 90-day buckets, ordered
// worst-first), computed on the fly from Invoice / Receipt. `client-accounting.read`.

import { apiGet } from '../auth/api-client';

export const AR_AGEING_BUCKET_KEYS = [
  'current',
  'd1_30',
  'd31_60',
  'd61_90',
  'd90_plus',
] as const;
export type ArAgeingBucketKey = (typeof AR_AGEING_BUCKET_KEYS)[number];

export const AR_AGEING_BUCKET_LABEL: Record<ArAgeingBucketKey, string> = {
  current: 'Current',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: '90+ days',
};

export type ArAgeingBucketAmounts = Record<ArAgeingBucketKey, string>;

export interface CustomerReceivablesRow extends ArAgeingBucketAmounts {
  customerId: string;
  customerLegalName: string;
  currency: string;
  outstandingTotal: string;
  invoiceCount: number;
  oldestDueDate: string | null;
  oldestDaysOverdue: number;
}

export interface ReceivablesAgeingTotals extends ArAgeingBucketAmounts {
  outstandingTotal: string;
  invoiceCount: number;
  customerCount: number;
}

export interface ReceivablesAgeingReport {
  asOf: string;
  currency: string;
  rows: CustomerReceivablesRow[];
  totals: ReceivablesAgeingTotals;
}

export function getReceivablesAgeing(
  opts: { customerId?: string; asOf?: string } = {},
): Promise<ReceivablesAgeingReport> {
  const params = new URLSearchParams();
  if (opts.customerId) params.set('customerId', opts.customerId);
  if (opts.asOf) params.set('asOf', opts.asOf);
  const qs = params.toString();
  return apiGet(`/client-accounting/ageing${qs ? `?${qs}` : ''}`);
}
