import type { TranslationKey } from '../i18n/translations';
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

/**
 * THE BUCKET HEADINGS, AS TRANSLATION KEYS RATHER THAN ENGLISH STRINGS.
 *
 * This map used to hold five literal English words and was rendered as the column headers of
 * `/client-accounting` — on an Arabic-first product, on the screen that says what clients owe the
 * office. `hardcoded-ui-english.py` reported 0 undeclared throughout, correctly by its own rules:
 * it scans `app/(app)` and `components/`, and this file is in `lib/`. The same blind-spot class
 * that script already records against itself, one directory further out.
 *
 * THREE ARE POINTERS at strings already rendering the identical range on `/dashboards/claims`, and
 * `current` is a slice of `commonCurrentLabel` with its inline colon dropped — decision 41's
 * mechanism, which is why no word was written for any of them.
 *
 * `d1_30` IS DELIBERATELY STILL ENGLISH. The nearest shipping string, `dclmAgeing0To30`, covers
 * DAY ZERO — and on a receivables report day zero is the `current` bucket, which is a separate
 * column one place to the left. Pointing at it would put a header over this column claiming a
 * range it does not hold, which is a false label and worse than an English one. The word is owed;
 * see `docs/design-pass-register.md`.
 */
export const AR_AGEING_BUCKET_LABEL_KEY: Record<ArAgeingBucketKey, TranslationKey | null> = {
  current: 'commonCurrentHeading',
  d1_30: null,
  d31_60: 'dclmAgeing31To60',
  d61_90: 'dclmAgeing61To90',
  d90_plus: 'dclmAgeing90Plus',
};

/** The fallback for the one bucket with no shipping word. Never widen this. */
export const AR_AGEING_BUCKET_FALLBACK: Record<ArAgeingBucketKey, string> = {
  current: '',
  d1_30: '1–30 days',
  d31_60: '',
  d61_90: '',
  d90_plus: '',
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
