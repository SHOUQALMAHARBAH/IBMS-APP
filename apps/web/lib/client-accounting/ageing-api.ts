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
 * `d1_30` IS `caAgeing1To30` AND NOT `dclmAgeing0To30` — owner answer 1, and the distinction is
 * one codepoint. That string covers DAY ZERO (U+0660 against U+0661), and on a receivables report
 * day zero is the `current` bucket, a separate column one place to the left; pointing at it would
 * put a header over this column claiming a range it does not hold. The new key's own comment in
 * `translations/finance.ts` says so, because the two strings differing by one character is exactly
 * the near-match a later reader in a hurry points at.
 *
 * THE MAP IS TOTAL AND NO LONGER CARRIES A `null`. There was a one-entry
 * `AR_AGEING_BUCKET_FALLBACK` beside it, for the one bucket with no word, carrying *"Never widen
 * this"* — it is DELETED rather than emptied: with every bucket worded it has no live member left,
 * and a fallback that still exists is a fallback something can be added to.
 */
export const AR_AGEING_BUCKET_LABEL_KEY: Record<ArAgeingBucketKey, TranslationKey> = {
  current: 'commonCurrentHeading',
  d1_30: 'caAgeing1To30',
  d31_60: 'dclmAgeing31To60',
  d61_90: 'dclmAgeing61To90',
  d90_plus: 'dclmAgeing90Plus',
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
